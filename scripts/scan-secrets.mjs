import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const mode = process.argv[2] || "working";
const maxBytes = 1024 * 1024;
const forbidden = /(^|\/)(\.env(?!\.example)(?:\.[^/]*)?|graphify-out|\.mongo-[^/]*|\.next[^/]*|node_modules)(\/|$)|(^|\/)(out|dist|coverage)(\/|$)/i;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?(?!process\.env|env\.|undefined\b|null\b|true\b|false\b|dummy|example|placeholder|your_|<)[A-Za-z0-9_./+=-]{24,}/i,
  /\b(?:mongodb(?:\+srv)?|rediss?):\/\/[^\s:@/]+:[^\s@/]+@/i,
];
let files;
if (mode === "staged") files = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]).toString().split("\0").filter(Boolean);
else if (mode === "outgoing") {
  const base = process.env.VERIFY_BASE_REF || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/development");
  files = execFileSync("git", ["diff", `${base}...HEAD`, "--name-only", "--diff-filter=ACMR", "-z"]).toString().split("\0").filter(Boolean);
} else files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean);

const errors = [];
for (const file of new Set(files)) {
  const normalized = file.replaceAll("\\", "/");
  if (forbidden.test(normalized)) { errors.push(`${normalized}: forbidden path`); continue; }
  try {
    if (statSync(file).size > maxBytes) { errors.push(`${normalized}: file exceeds 1 MiB limit`); continue; }
    if (path.basename(file) === ".env.example") continue;
    const text = readFileSync(file, "utf8");
    if (secretPatterns.some((pattern) => pattern.test(text))) errors.push(`${normalized}: secret-like content detected (value suppressed)`);
  } catch {
    // A staged file can be removed between Git enumeration and the filesystem read.
  }
}
if (errors.length) {
  console.error(`Secret/path scan failed (${errors.length} finding${errors.length === 1 ? "" : "s"}):\n${errors.join("\n")}`);
  process.exit(1);
}
console.log(`Secret/path scan passed for ${new Set(files).size} files; no values were printed.`);
