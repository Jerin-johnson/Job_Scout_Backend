export function buildJobScheduleReport(sources, repeatableJobs, now = Date.now(), worker = { online: false, lastSeenAt: null }) {
  const byName = new Map();
  for (const job of repeatableJobs || []) {
    if (typeof job?.name === "string") byName.set(job.name, job);
  }

  return (sources || []).map((source) => {
    const enabled = Boolean(source.enabled && source.approved && source.quota?.intervalMs);
    const name = `ingest:${source.key}`;
    const scheduled = enabled ? byName.get(name) : null;
    const intervalMatches = scheduled?.every === source.quota.intervalMs;
    return {
      source: source.key,
      worker: { status: worker?.online ? "online" : "offline", online: Boolean(worker?.online), lastSeenAt: worker?.lastSeenAt || null },
      enabled,
      intervalMs: source.quota?.intervalMs ?? null,
      registrationStatus: !enabled ? "disabled" : scheduled ? (intervalMatches ? "registered" : "interval_mismatch") : "not_registered",
      nextScheduledRun: intervalMatches && Number.isFinite(Number(scheduled.next))
        ? new Date(Number(scheduled.next)).toISOString()
        : null,
      nextEligibleFromLastRun:
        enabled && source.lastRunAt && source.quota?.intervalMs
          ? new Date(Math.max(now, new Date(source.lastRunAt).getTime() + source.quota.intervalMs)).toISOString()
          : null,
    };
  });
}
