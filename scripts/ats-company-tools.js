import { readFile, writeFile } from "node:fs/promises";
import { detectAtsCareersUrl } from "../src/services/jobs/trackedCompanyService.js";

const ENDPOINTS = {
  greenhouse: (slug) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=false`,
  lever: (slug) => `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=false`,
};

export function parseCompanyCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") { row.push(field); field = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header = [], ...records] = rows;
  const keys = header.map((value) => value.trim().toLowerCase());
  return records.map((values) => Object.fromEntries(keys.map((key, index) => [key, (values[index] || "").trim()])));
}

export function normalizeCompanyCandidate(candidate) {
  const careersUrl = candidate.careersUrl || candidate.careersurl || candidate.careers_url;
  const slug = String(candidate.slug || "").trim().toLowerCase();
  const platform = String(candidate.ats || candidate.platform || "").trim().toLowerCase();
  const detected = careersUrl ? detectAtsCareersUrl(careersUrl)
    : platform && /^[a-z0-9_-]{1,100}$/.test(slug) && ENDPOINTS[platform]
      ? { platform, slug, careersUrl: "" } : null;
  if (!detected) return { company: String(candidate.name || "").trim(), valid: false, error: "Unsupported ATS careers URL or missing ATS/slug." };
  return { company: String(candidate.name || detected.slug).trim(), ...detected, valid: false };
}

function postingsFrom(platform, body) {
  if (platform === "greenhouse") return Array.isArray(body?.jobs) ? body.jobs : null;
  if (platform === "lever") return Array.isArray(body) ? body : null;
  if (platform === "ashby") return Array.isArray(body?.jobs) ? body.jobs : null;
  return null;
}

function postingLocation(platform, job) {
  if (platform === "greenhouse") return String(job.location?.name || "");
  if (platform === "lever") return String(job.categories?.location || job.workplaceType || "");
  return String(job.location || job.workplaceType || "");
}

async function readBoundedBody(response, cap = 2_000_000) {
  if (Number(response.headers.get("content-length") || 0) > cap) throw new Error("Response exceeded the 2 MB safety limit.");
  const reader = response.body?.getReader?.();
  if (!reader) {
    const body = await response.text();
    if (Buffer.byteLength(body) > cap) throw new Error("Response exceeded the 2 MB safety limit.");
    return body;
  }
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > cap) { await reader.cancel(); throw new Error("Response exceeded the 2 MB safety limit."); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function validateCompanyCandidate(company, { fetchImpl = fetch } = {}) {
  if (!company.platform || !ENDPOINTS[company.platform] || !company.slug) return { ...company, valid: false, jobCount: 0, remoteCount: 0, indiaCount: 0, error: company.error || "Invalid source identity." };
  try {
    const response = await fetchImpl(ENDPOINTS[company.platform](company.slug), { headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (response.status >= 300 && response.status < 400) throw new Error("Redirect rejected by source URL policy.");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = JSON.parse(await readBoundedBody(response));
    const postings = postingsFrom(company.platform, body);
    if (!postings) throw new Error("Unexpected public job-board response shape.");
    const locations = postings.map((job) => postingLocation(company.platform, job));
    return { ...company, valid: true, jobCount: postings.length, remoteCount: locations.filter((value) => /remote|anywhere/i.test(value)).length, indiaCount: locations.filter((value) => /india|bengaluru|bangalore|kerala|kochi|chennai|hyderabad|mumbai|pune|delhi|gurugram|noida|kolkata|ahmedabad/i.test(value)).length, checkedAt: new Date().toISOString(), error: "" };
  } catch (error) {
    const message = error.name === "TimeoutError" || error.name === "AbortError" ? "Request timed out." : error.message;
    return { ...company, valid: false, jobCount: 0, remoteCount: 0, indiaCount: 0, checkedAt: new Date().toISOString(), error: message.slice(0, 160) };
  }
}

async function loadCompanies(path) {
  const contents = await readFile(path, "utf8");
  if (path.toLowerCase().endsWith(".csv")) return parseCompanyCsv(contents);
  const parsed = JSON.parse(contents);
  return Array.isArray(parsed) ? parsed : parsed.companies;
}

async function validateFile() {
  const input = process.argv.find((arg) => arg.startsWith("--file="))?.slice(7);
  if (!input) throw new Error("Usage: npm run jobs:ats:validate -- --file=companies.csv [--output=verified.json]");
  const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) || "ats-verified.json";
  const candidates = await loadCompanies(input);
  if (!Array.isArray(candidates)) throw new Error("Input must be an array, {companies: []}, or CSV with a header row.");
  if (candidates.length > 500) throw new Error("Validate at most 500 companies per run to keep public board checks bounded.");
  const results = [];
  for (const row of candidates) {
    const normalized = normalizeCompanyCandidate(row);
    results.push(normalized.platform ? await validateCompanyCandidate(normalized) : { ...normalized, jobCount: 0, remoteCount: 0, indiaCount: 0, error: normalized.error });
    // one request/second across the validation run, bounded by provider public endpoints.
    if (results.length < candidates.length) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log("Company | ATS | Status | Jobs | Remote | India jobs | Error");
  for (const row of results) console.log(`${row.company} | ${row.platform || "—"} | ${row.valid ? "valid" : "invalid"} | ${row.jobCount} | ${row.remoteCount} | ${row.indiaCount} | ${row.error || "—"}`);
  await writeFile(output, `${JSON.stringify({ version: 1, verifiedAt: new Date().toISOString(), companies: results.filter((row) => row.valid).map((row) => ({ name: row.company, platform: row.platform, slug: row.slug, careersUrl: row.careersUrl || `https://${row.platform === "greenhouse" ? "boards.greenhouse.io" : row.platform === "lever" ? "jobs.lever.co" : "jobs.ashbyhq.com"}/${row.slug}`, status: "pending", validation: { valid: true, jobCount: row.jobCount, remoteCount: row.remoteCount, indiaCount: row.indiaCount, checkedAt: row.checkedAt } })) }, null, 2)}\n`, { flag: "wx" });
  console.log(`Verified companies ready for approval import: ${results.filter((row) => row.valid).length}; file: ${output}`);
}

async function importFile() {
  const input = process.argv.find((arg) => arg.startsWith("--file="))?.slice(7);
  const requestedBy = process.argv.find((arg) => arg.startsWith("--requested-by="))?.slice(15);
  if (!input || !requestedBy) throw new Error("Usage: npm run jobs:ats:import -- --file=ats-verified.json --requested-by=<admin-user-id>");
  const { connectMongo, disconnectMongo } = await import("../src/config/database.js");
  const { env } = await import("../src/config/env.js");
  const mongoose = (await import("mongoose")).default;
  const { User } = await import("../src/models/User.js");
  const { TrackedCompany } = await import("../src/models/TrackedCompany.js");
  const hostname = new URL(env.MONGODB_URI).hostname;
  if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(hostname)) throw new Error("Refusing company import: only a non-production loopback Mongo URI is allowed.");
  if (!mongoose.isValidObjectId(requestedBy)) throw new Error("--requested-by must be an admin user's ObjectId.");
  const file = JSON.parse(await readFile(input, "utf8"));
  if (file.version !== 1 || !Array.isArray(file.companies) || file.companies.some((row) => row.status !== "pending" || row.validation?.valid !== true)) throw new Error("Import accepts only a valid version-1 output from jobs:ats:validate.");
  await connectMongo();
  try {
    if (!await User.findOne({ _id: requestedBy, role: { $in: ["admin", "super_admin"] } }).select("_id").lean()) throw new Error("Requested-by user is not an admin.");
    const ops = file.companies.map((row) => ({ updateOne: { filter: { platform: row.platform, slug: row.slug }, update: { $setOnInsert: { platform: row.platform, slug: row.slug, careersUrl: row.careersUrl, requestedBy, verifiedAt: new Date(row.validation.checkedAt), status: "pending" } }, upsert: true } }));
    const result = ops.length ? await TrackedCompany.bulkWrite(ops, { ordered: false }) : { upsertedCount: 0 };
    console.log(JSON.stringify({ importedPending: result.upsertedCount || 0, alreadyPresent: ops.length - (result.upsertedCount || 0), count: ops.length }));
  } finally { await disconnectMongo(); }
}

if (process.argv[1]?.endsWith("ats-company-tools.js")) {
  try { await (process.argv[2] === "import" ? importFile() : validateFile()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
