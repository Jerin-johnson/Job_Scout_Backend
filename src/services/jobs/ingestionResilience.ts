export interface IngestionAlertThresholds {
  readonly warningFailureThreshold: number;
  readonly circuitFailureThreshold: number;
  readonly baseCircuitOpenMs: number;
  readonly maxCircuitOpenMs: number;
  readonly quotaExhaustionWarningRatio: number;
  readonly deadLetterWarningCount: number;
  readonly staleSuccessMultiplier: number;
  readonly minStaleSuccessMs: number;
}

export const INGESTION_ALERT_THRESHOLDS: IngestionAlertThresholds = Object.freeze({
  warningFailureThreshold: 3,
  circuitFailureThreshold: 5,
  baseCircuitOpenMs: 5 * 60_000,
  maxCircuitOpenMs: 60 * 60_000,
  quotaExhaustionWarningRatio: 0.9,
  deadLetterWarningCount: 10,
  staleSuccessMultiplier: 2,
  minStaleSuccessMs: 48 * 3600_000,
});

let shuttingDown = false;

export function requestIngestionShutdown(): void {
  shuttingDown = true;
}

export function resetIngestionShutdown(): void {
  shuttingDown = false;
}

export function isIngestionShuttingDown(): boolean {
  return shuttingDown;
}

export interface RetryBackoffOptions {
  baseMs?: number;
  maxMs?: number;
  jitterMs?: number;
}

export function computeRetryBackoffMs(
  attempt: number | string | undefined,
  { baseMs = 300, maxMs = 4000, jitterMs = 0 }: RetryBackoffOptions = {},
): number {
  const safeAttempt = Math.max(0, Number(attempt) || 0);
  const exp = Math.min(maxMs, baseMs * 2 ** safeAttempt);
  return Math.min(maxMs, Math.max(0, Math.round(exp + (Number(jitterMs) || 0))));
}

export interface CircuitOpenOptions {
  threshold?: number;
  baseOpenMs?: number;
  maxOpenMs?: number;
  now?: Date | string | number;
}

export function computeCircuitOpenUntil(
  failures: number | string | undefined,
  {
    threshold = INGESTION_ALERT_THRESHOLDS.circuitFailureThreshold,
    baseOpenMs = INGESTION_ALERT_THRESHOLDS.baseCircuitOpenMs,
    maxOpenMs = INGESTION_ALERT_THRESHOLDS.maxCircuitOpenMs,
    now = new Date(),
  }: CircuitOpenOptions = {},
): Date | null {
  const count = Number(failures) || 0;
  if (count < threshold) return null;
  const exponent = Math.min(6, count - threshold);
  const durationMs = Math.min(maxOpenMs, baseOpenMs * 2 ** exponent);
  return new Date(new Date(now).getTime() + durationMs);
}

export interface ValidateJobResult {
  valid: boolean;
  reasonCode?: string;
  message?: string;
}

export function validateRawIngestJob(rawJob: unknown): ValidateJobResult {
  if (!rawJob || typeof rawJob !== "object") {
    return {
      valid: false,
      reasonCode: "MALFORMED_RECORD",
      message: "Job record is not an object",
    };
  }
  const jobObj = rawJob as Record<string, unknown>;
  const title = String(jobObj.title || "").trim();
  const company = String(jobObj.company || "").trim();
  if (!title && !company) {
    return {
      valid: false,
      reasonCode: "MISSING_TITLE_AND_COMPANY",
      message: "Job record is missing both title and company",
    };
  }
  if (!title) {
    return {
      valid: false,
      reasonCode: "MISSING_TITLE",
      message: "Job record is missing a title",
    };
  }
  if (!company) {
    return {
      valid: false,
      reasonCode: "MISSING_COMPANY",
      message: "Job record is missing a company",
    };
  }
  return { valid: true };
}

export interface DeadLetterEntry {
  sourceJobId: string;
  reasonCode: string;
  message: string;
  recordedAt: Date;
}

export function buildDeadLetterEntry({
  sourceJobId = "",
  reasonCode = "INVALID_JOB_RECORD",
  message = "",
  now = new Date(),
}: {
  sourceJobId?: string;
  reasonCode?: string;
  message?: string;
  now?: Date | string | number;
} = {}): DeadLetterEntry {
  return {
    sourceJobId: String(sourceJobId || "").slice(0, 120),
    reasonCode: String(reasonCode || "INVALID_JOB_RECORD").slice(0, 64),
    message: String(message || "").slice(0, 240),
    recordedAt: new Date(now),
  };
}

export function appendDeadLetters(
  existing: DeadLetterEntry[] = [],
  incoming: DeadLetterEntry[] = [],
  maxItems = 50,
): DeadLetterEntry[] {
  const combined = [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ];
  if (combined.length <= maxItems) return combined;
  return combined.slice(combined.length - maxItems);
}

export interface SourceHealthAlert {
  code: string;
  severity: "critical" | "warning";
  message: string;
}

export interface SourceHealthEvaluation {
  healthStatus: "healthy" | "disabled" | "critical" | "warning";
  alerts: SourceHealthAlert[];
  thresholds: IngestionAlertThresholds;
}

export interface SourceLike {
  enabled?: boolean;
  approved?: boolean;
  circuit?: {
    failures?: number;
    openUntil?: Date | string | null;
  };
  quota?: {
    requestsPerDay?: number;
    intervalMs?: number;
  };
  quotaUsed?: number;
  metrics?: {
    deadLettered?: number;
  };
  deadLetters?: unknown[];
  lastSuccessAt?: Date | string | null;
  runState?: string;
  [key: string]: unknown;
}

export function evaluateSourceHealthAlerts(
  source: SourceLike = {},
  { now = new Date() }: { now?: Date | string | number } = {},
): SourceHealthEvaluation {
  const nowMs = new Date(now).getTime();
  const alerts: SourceHealthAlert[] = [];
  const enabled = Boolean(source.enabled && source.approved);
  const failures = Number(source.circuit?.failures || 0);
  const openUntil = source.circuit?.openUntil ? new Date(source.circuit.openUntil) : null;
  const circuitOpen = Boolean(openUntil && openUntil.getTime() > nowMs);

  if (circuitOpen) {
    alerts.push({
      code: "CIRCUIT_OPEN",
      severity: "critical",
      message: `Circuit breaker is open until ${openUntil?.toISOString()} after ${failures} failures.`,
    });
  } else if (failures >= INGESTION_ALERT_THRESHOLDS.warningFailureThreshold) {
    alerts.push({
      code: "CONSECUTIVE_FAILURES",
      severity:
        failures >= INGESTION_ALERT_THRESHOLDS.circuitFailureThreshold ? "critical" : "warning",
      message: `Source has ${failures} consecutive ingestion failures.`,
    });
  }

  const requestsPerDay = Number(source.quota?.requestsPerDay || 0);
  const quotaUsed = Number(source.quotaUsed || 0);
  if (
    requestsPerDay > 0 &&
    quotaUsed / requestsPerDay >= INGESTION_ALERT_THRESHOLDS.quotaExhaustionWarningRatio
  ) {
    alerts.push({
      code: "QUOTA_NEAR_EXHAUSTION",
      severity: "warning",
      message: `Daily request budget is at ${Math.round((quotaUsed / requestsPerDay) * 100)}% (${quotaUsed}/${requestsPerDay}).`,
    });
  }

  const deadLetterCount = Number(source.metrics?.deadLettered ?? source.deadLetters?.length ?? 0);
  if (deadLetterCount >= INGESTION_ALERT_THRESHOLDS.deadLetterWarningCount) {
    alerts.push({
      code: "DEAD_LETTER_SPIKE",
      severity: "warning",
      message: `${deadLetterCount} records routed to dead-letter storage.`,
    });
  }

  if (enabled) {
    const intervalMs = Number(source.quota?.intervalMs || 86400000);
    const staleThresholdMs = Math.max(
      INGESTION_ALERT_THRESHOLDS.minStaleSuccessMs,
      intervalMs * INGESTION_ALERT_THRESHOLDS.staleSuccessMultiplier,
    );
    const lastSuccessMs = source.lastSuccessAt ? new Date(source.lastSuccessAt).getTime() : 0;
    if (lastSuccessMs > 0 && nowMs - lastSuccessMs > staleThresholdMs) {
      alerts.push({
        code: "STALE_LAST_SUCCESS",
        severity: "warning",
        message: `Last successful sync was more than ${Math.round(staleThresholdMs / 3600000)}h ago.`,
      });
    }
  }

  let healthStatus: "healthy" | "disabled" | "critical" | "warning" = "healthy";
  if (!enabled) {
    healthStatus = "disabled";
  } else if (alerts.some((alert) => alert.severity === "critical")) {
    healthStatus = "critical";
  } else if (alerts.length > 0 || source.runState === "degraded") {
    healthStatus = "warning";
  }

  return {
    healthStatus,
    alerts,
    thresholds: INGESTION_ALERT_THRESHOLDS,
  };
}
