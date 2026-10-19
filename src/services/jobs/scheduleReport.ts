export interface SourceScheduleEntry {
  key: string;
  enabled?: boolean;
  approved?: boolean;
  quota?: { intervalMs?: number };
  lastRunAt?: Date | string | null;
  [key: string]: unknown;
}

export interface RepeatableJobEntry {
  name?: string;
  every?: number;
  next?: number | string;
  [key: string]: unknown;
}

export interface WorkerStatusInfo {
  online?: boolean;
  lastSeenAt?: string | null;
}

export interface JobScheduleReportItem {
  source: string;
  worker: {
    status: "online" | "offline";
    online: boolean;
    lastSeenAt: string | null;
  };
  enabled: boolean;
  intervalMs: number | null;
  registrationStatus: "disabled" | "registered" | "interval_mismatch" | "not_registered";
  nextScheduledRun: string | null;
  nextEligibleFromLastRun: string | null;
}

export function buildJobScheduleReport(
  sources: SourceScheduleEntry[] = [],
  repeatableJobs: RepeatableJobEntry[] = [],
  now: number = Date.now(),
  worker: WorkerStatusInfo = { online: false, lastSeenAt: null },
): JobScheduleReportItem[] {
  const byName = new Map<string, RepeatableJobEntry>();
  for (const job of repeatableJobs || []) {
    if (typeof job?.name === "string") byName.set(job.name, job);
  }

  return (sources || []).map((source) => {
    const enabled = Boolean(source.enabled && source.approved && source.quota?.intervalMs);
    const name = `ingest:${source.key}`;
    const scheduled = enabled ? byName.get(name) : null;
    const intervalMatches = scheduled?.every === source.quota?.intervalMs;
    return {
      source: source.key,
      worker: {
        status: worker?.online ? "online" : "offline",
        online: Boolean(worker?.online),
        lastSeenAt: worker?.lastSeenAt || null,
      },
      enabled,
      intervalMs: source.quota?.intervalMs ?? null,
      registrationStatus: !enabled
        ? "disabled"
        : scheduled
          ? intervalMatches
            ? "registered"
            : "interval_mismatch"
          : "not_registered",
      nextScheduledRun:
        intervalMatches && scheduled?.next && Number.isFinite(Number(scheduled.next))
          ? new Date(Number(scheduled.next)).toISOString()
          : null,
      nextEligibleFromLastRun:
        enabled && source.lastRunAt && source.quota?.intervalMs
          ? new Date(Math.max(now, new Date(source.lastRunAt).getTime() + source.quota.intervalMs)).toISOString()
          : null,
    };
  });
}
