export const INGESTION_ALERT_THRESHOLDS = Object.freeze({
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

export function requestIngestionShutdown() {
  shuttingDown = true;
}

export function resetIngestionShutdown() {
  shuttingDown = false;
}

export function isIngestionShuttingDown() {
  return shuttingDown;
}

export function computeRetryBackoffMs(attempt, { baseMs = 300, maxMs = 4000, jitterMs = 0 } = {}) {
  const safeAttempt = Math.max(0, Number(attempt) || 0);
  const exp = Math.min(maxMs, baseMs * 2 ** safeAttempt);
  return Math.min(maxMs, Math.max(0, Math.round(exp + (Number(jitterMs) || 0))));
}

export function computeCircuitOpenUntil(
  failures,
  {
    threshold = INGESTION_ALERT_THRESHOLDS.circuitFailureThreshold,
    baseOpenMs = INGESTION_ALERT_THRESHOLDS.baseCircuitOpenMs,
    maxOpenMs = INGESTION_ALERT_THRESHOLDS.maxCircuitOpenMs,
    now = new Date(),
  } = {},
) {
  const count = Number(failures) || 0;
  if (count < threshold) return null;
  const exponent = Math.min(6, count - threshold);
  const durationMs = Math.min(maxOpenMs, baseOpenMs * 2 ** exponent);
  return new Date(new Date(now).getTime() + durationMs);
}

export function validateRawIngestJob(rawJob) {
  if (!rawJob || typeof rawJob !== "object") {
    return {
      valid: false,
      reasonCode: "MALFORMED_RECORD",
      message: "Job record is not an object",
    };
  }
  const title = String(rawJob.title || "").trim();
  const company = String(rawJob.company || "").trim();
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

export function buildDeadLetterEntry({
  sourceJobId = "",
  reasonCode = "INVALID_JOB_RECORD",
  message = "",
  now = new Date(),
} = {}) {
  return {
    sourceJobId: String(sourceJobId || "").slice(0, 120),
    reasonCode: String(reasonCode || "INVALID_JOB_RECORD").slice(0, 64),
    message: String(message || "").slice(0, 240),
    recordedAt: new Date(now),
  };
}

export function appendDeadLetters(existing = [], incoming = [], maxItems = 50) {
  const combined = [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(incoming) ? incoming : []),
  ];
  if (combined.length <= maxItems) return combined;
  return combined.slice(combined.length - maxItems);
}

export function evaluateSourceHealthAlerts(source = {}, { now = new Date() } = {}) {
  const nowMs = new Date(now).getTime();
  const alerts = [];
  const enabled = Boolean(source.enabled && source.approved);
  const failures = Number(source.circuit?.failures || 0);
  const openUntil = source.circuit?.openUntil ? new Date(source.circuit.openUntil) : null;
  const circuitOpen = Boolean(openUntil && openUntil.getTime() > nowMs);

  if (circuitOpen) {
    alerts.push({
      code: "CIRCUIT_OPEN",
      severity: "critical",
      message: `Circuit breaker is open until ${openUntil.toISOString()} after ${failures} failures.`,
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

  let healthStatus = "healthy";
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
