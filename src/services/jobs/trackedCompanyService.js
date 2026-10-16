import { TrackedCompany } from "../../models/TrackedCompany.js";

const ATS_URLS = {
  greenhouse: { match: /^\/([a-z0-9_-]+)\/?$/i, endpoint: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true` },
  lever: { match: /^\/([a-z0-9_-]+)\/?$/i, endpoint: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json` },
  ashby: { match: /^\/([a-z0-9_-]+)\/?$/i, endpoint: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}` },
};

export function detectAtsCareersUrl(input) {
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  for (const [platform, config] of Object.entries(ATS_URLS)) {
    const expectedHost = platform === "greenhouse" ? "boards.greenhouse.io" : platform === "lever" ? "jobs.lever.co" : "jobs.ashbyhq.com";
    const match = url.host.toLowerCase() === expectedHost && url.pathname.match(config.match);
    if (match) return { platform, slug: match[1].toLowerCase(), careersUrl: `${url.origin}${url.pathname}` };
  }
  return null;
}

export async function verifyPublicBoard({ platform, slug }, fetchImpl = fetch) {
  const config = ATS_URLS[platform];
  if (!config) return false;
  const response = await fetchImpl(config.endpoint(slug), {
    method: "GET",
    redirect: "manual", signal: AbortSignal.timeout(5000),
    headers: platform === "ashby" ? { "content-type": "application/json" } : { accept: "application/json" },
  });
  if (response.status >= 300 && response.status < 400) return false;
  if (!response.ok) return false;
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 2_000_000) return false;
  let body;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) {
          await reader.cancel();
          return false;
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    body = new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  } else {
    body = await response.text();
    if (Buffer.byteLength(body) > 2_000_000) return false;
  }
  JSON.parse(body);
  return true;
}

export async function requestCompanyTracking(careersUrl, userId, fetchImpl = fetch) {
  const detected = detectAtsCareersUrl(careersUrl);
  if (!detected) {
    const error = new Error("Paste a public Greenhouse, Lever or Ashby careers board URL.");
    error.statusCode = 400; error.code = "UNSUPPORTED_CAREERS_URL"; throw error;
  }
  const verified = await verifyPublicBoard(detected, fetchImpl);
  if (!verified) {
    const error = new Error("We could not verify that public job board. Check the careers URL and try again.");
    error.statusCode = 422; error.code = "CAREERS_BOARD_UNVERIFIED"; throw error;
  }
  const company = await TrackedCompany.findOneAndUpdate(
    { platform: detected.platform, slug: detected.slug },
    { $setOnInsert: { ...detected, status: "pending", requestedBy: userId, verifiedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).select("platform slug careersUrl status createdAt").lean();
  return company;
}
