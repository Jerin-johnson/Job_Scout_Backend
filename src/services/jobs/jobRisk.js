/** Explainable warnings only; these signals are not a fraud verdict. */
export function getJobRiskFlags(job = {}) {
  const text = `${job.title || ""} ${job.company || ""} ${job.rawDescription || ""} ${(job.tags || []).join(" ")}`.slice(0, 16000);
  const flags = [];
  if (/\b(?:pay|send|transfer)\s+(?:a\s+)?(?:fee|deposit|registration fee|training fee)\b/i.test(text)) flags.push({ code: "fees_requested", reason: "The listing appears to request a fee." });
  if (/\b(?:whatsapp|telegram|signal)\s+(?:only|message|contact|apply)\b/i.test(text)) flags.push({ code: "messaging_app_only", reason: "Contact or applications appear to rely on a messaging app." });
  if (/\b(?:gmail\.com|yahoo\.com|outlook\.com)\b/i.test(text) && /\b(?:recruit|hr|hiring|apply)\b/i.test(text)) flags.push({ code: "free_email_contact", reason: "Recruiter contact uses a free email provider." });
  if (/\b(?:earn|salary|pay)\s+(?:up to\s+)?(?:\$|₹|usd\s*)\s?(?:[1-9]\d{4,}|[1-9]\d{2,}\s*(?:lpa|per month))\b/i.test(text)) flags.push({ code: "salary_unusually_high", reason: "The stated pay may be unusually high for the role." });
  if (String(job.company || "").trim().length < 2 || /\b(?:unknown|confidential|undisclosed|stealth company)\b/i.test(job.company || "")) flags.push({ code: "company_unclear", reason: "The employer name is unclear." });
  return flags;
}
