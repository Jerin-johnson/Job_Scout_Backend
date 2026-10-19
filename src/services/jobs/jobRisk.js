/** Explainable warnings only; these signals are not a fraud verdict. */
export function getJobRiskFlags(job = {}, { now = new Date() } = {}) {
  const nowMs = new Date(now).getTime();
  const text =
    `${job.title || ""} ${job.company || ""} ${job.rawDescription || ""} ${(job.tags || []).join(" ")}`.slice(
      0,
      16000,
    );
  const flags = [];
  const postedAt = job.postedDateKnown === false || !job.postedAt ? null : new Date(job.postedAt);
  const firstSeenAt = job.firstSeenAt ? new Date(job.firstSeenAt) : null;
  const lastSeenAt = job.lastSeenAt ? new Date(job.lastSeenAt) : null;
  const repostCount = Number(job.repostCount || 0);
  const expiredReports = Number(
    job.reportCounts?.expired ?? job.reportCounts?.get?.("expired") ?? 0,
  );
  const brokenLinkReports = Number(
    job.reportCounts?.broken_link ?? job.reportCounts?.get?.("broken_link") ?? 0,
  );

  if (postedAt && !Number.isNaN(postedAt.getTime()) && nowMs - postedAt.getTime() > 30 * 86400000) {
    flags.push({
      code: "older_listing",
      reason: "This listing has an older posted date. Confirm it is still open before applying.",
    });
  }
  if (
    repostCount >= 1 ||
    (postedAt &&
      firstSeenAt &&
      !Number.isNaN(postedAt.getTime()) &&
      !Number.isNaN(firstSeenAt.getTime()) &&
      Math.abs(firstSeenAt.getTime() - postedAt.getTime()) > 7 * 86400000)
  ) {
    flags.push({
      code: "possible_repost",
      reason:
        "This listing appeared in the catalog well after its posted date; confirm the role is still current.",
    });
  }
  const openDurationMs =
    firstSeenAt &&
    lastSeenAt &&
    !Number.isNaN(firstSeenAt.getTime()) &&
    !Number.isNaN(lastSeenAt.getTime())
      ? lastSeenAt.getTime() - firstSeenAt.getTime()
      : 0;
  if (
    repostCount >= 2 ||
    openDurationMs > 45 * 86400000 ||
    job.status === "stale" ||
    expiredReports >= 2
  ) {
    flags.push({
      code: "ghost_listing_risk",
      reason:
        "This role has remained open or been reposted across multiple cycles; verify it is actively hiring.",
    });
  }
  if (job.status === "closed" || job.linkHealthStatus === "broken" || brokenLinkReports >= 2) {
    flags.push({
      code: "broken_or_expired_link",
      reason: "Application link may be expired or unreachable.",
    });
  }
  if (
    /\b(?:pay|send|transfer)\s+(?:a\s+)?(?:fee|deposit|registration fee|training fee)\b/i.test(text)
  )
    flags.push({ code: "fees_requested", reason: "The listing appears to request a fee." });
  if (/\b(?:whatsapp|telegram|signal)\s+(?:only|message|contact|apply)\b/i.test(text))
    flags.push({
      code: "messaging_app_only",
      reason: "Contact or applications appear to rely on a messaging app.",
    });
  if (
    /\b(?:gmail\.com|yahoo\.com|outlook\.com)\b/i.test(text) &&
    /\b(?:recruit|hr|hiring|apply)\b/i.test(text)
  )
    flags.push({
      code: "free_email_contact",
      reason: "Recruiter contact uses a free email provider.",
    });
  if (
    /\b(?:earn|salary|pay)\s+(?:up to\s+)?(?:\$|₹|usd\s*)\s?(?:[1-9]\d{4,}|[1-9]\d{2,}\s*(?:lpa|per month))\b/i.test(
      text,
    )
  )
    flags.push({
      code: "salary_unusually_high",
      reason: "The stated pay may be unusually high for the role.",
    });
  if (
    String(job.company || "").trim().length < 2 ||
    /\b(?:unknown|confidential|undisclosed|stealth company)\b/i.test(job.company || "")
  )
    flags.push({ code: "company_unclear", reason: "The employer name is unclear." });
  return flags;
}

export function detectRepostSignal(existingJob, incomingJob) {
  const baseCount = Number(existingJob?.repostCount || 0);
  if (!existingJob) {
    return { isRepost: false, repostCountDelta: 0, repostCount: 0, reason: null };
  }
  if (existingJob.status === "closed" || existingJob.status === "stale") {
    return {
      isRepost: true,
      repostCountDelta: 1,
      repostCount: baseCount + 1,
      reason: `reactivated_from_${existingJob.status}`,
    };
  }
  const prevPosted = existingJob.postedAt ? new Date(existingJob.postedAt).getTime() : 0;
  const nextPosted = incomingJob?.postedAt ? new Date(incomingJob.postedAt).getTime() : 0;
  if (prevPosted > 0 && nextPosted > 0 && nextPosted - prevPosted >= 7 * 86400000) {
    return {
      isRepost: true,
      repostCountDelta: 1,
      repostCount: baseCount + 1,
      reason: "posted_date_bumped",
    };
  }
  return { isRepost: false, repostCountDelta: 0, repostCount: baseCount, reason: null };
}

export function classifyLinkHealthStatus({ httpStatus, finalUrl = "", bodySnippet = "" } = {}) {
  const code = Number(httpStatus) || 0;
  if (code === 404 || code === 410) {
    return { status: "closed", reason: `http_${code}` };
  }
  if (code >= 200 && code < 400) {
    const urlText = String(finalUrl || "");
    const snippet = String(bodySnippet || "").slice(0, 4000);
    if (
      /[?&](?:closed|expired|filled)=(?:1|true)\b/i.test(urlText) ||
      /\b(?:job|position|role|posting|opening)\s+(?:is\s+)?(?:no longer available|has been filled|is closed|has expired|no longer accepting applications)\b/i.test(
        snippet,
      )
    ) {
      return { status: "closed", reason: "closed_page_marker" };
    }
    return { status: "active", reason: "http_ok" };
  }
  return { status: "unknown", reason: code ? `http_${code}` : "network_or_timeout" };
}

export function sampleJobsForPoliteLinkCheck(
  jobs = [],
  {
    maxSample = 25,
    maxTotal,
    maxPerHost = 3,
    minRecheckAgeMs = 24 * 3600_000,
    now = new Date(),
  } = {},
) {
  const cap = Number(maxTotal ?? maxSample) || 25;
  const nowMs = new Date(now).getTime();
  const candidates = (Array.isArray(jobs) ? jobs : [])
    .filter((job) => {
      if (!job || job.status === "closed") return false;
      const lastCheckedMs = job.sourceCheckedAt ? new Date(job.sourceCheckedAt).getTime() : 0;
      return !lastCheckedMs || nowMs - lastCheckedMs >= minRecheckAgeMs;
    })
    .sort((a, b) => {
      const aChecked = a.sourceCheckedAt ? new Date(a.sourceCheckedAt).getTime() : 0;
      const bChecked = b.sourceCheckedAt ? new Date(b.sourceCheckedAt).getTime() : 0;
      if (aChecked !== bChecked) return aChecked - bChecked;
      const aSeen = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
      const bSeen = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
      return aSeen - bSeen;
    });

  const selected = [];
  const hostCounts = new Map();
  for (const job of candidates) {
    if (selected.length >= cap) break;
    const rawUrl = job.canonicalUrl || job.sourceUrl || "";
    let host = "default";
    if (rawUrl) {
      try {
        host = new URL(rawUrl).hostname.toLowerCase();
      } catch {
        continue;
      }
    }
    const used = hostCounts.get(host) || 0;
    if (used >= maxPerHost) continue;
    hostCounts.set(host, used + 1);
    selected.push(job);
  }
  return selected;
}

export function computeSourceTermExpiry({
  postedAt = null,
  firstSeenAt = null,
  now = new Date(),
  retentionDays = 30,
  sourceExpiresAt = null,
} = {}) {
  const nowDate = new Date(now);
  const anchor =
    postedAt && !Number.isNaN(new Date(postedAt).getTime())
      ? new Date(postedAt)
      : firstSeenAt && !Number.isNaN(new Date(firstSeenAt).getTime())
        ? new Date(firstSeenAt)
        : nowDate;
  const safeDays = Math.max(1, Number(retentionDays) || 30);
  const policyExpiry = new Date(anchor.getTime() + safeDays * 86400000);
  if (sourceExpiresAt && !Number.isNaN(new Date(sourceExpiresAt).getTime())) {
    const explicit = new Date(sourceExpiresAt);
    return explicit < policyExpiry ? explicit : policyExpiry;
  }
  return policyExpiry;
}
