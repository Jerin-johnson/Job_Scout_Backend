import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const baselineFile = "docs/engineering/commit-baseline.txt";
const base = process.env.VERIFY_BASE_REF || readFileSync(baselineFile, "utf8").trim();
let messages;
try { messages = execFileSync("git", ["log", "--format=%s", `${base}..HEAD`], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean); }
catch { console.error(`Cannot resolve comparison ref ${base}; fetch the base branch before verifying outgoing commits.`); process.exit(1); }
const types = "feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert";
const scopes = "jobs|resume|applications|interviews|chat|profile|ai|infra|docs|deps|release";
const pattern = new RegExp(`^(?:${types})\\((?:${scopes})\\)!?: .+`);
const invalid = messages.filter((message) => !pattern.test(message) || message.length > 72);
if (invalid.length) {
  console.error(`Outgoing commit messages must follow type(scope): subject and stay within 72 characters:\n${invalid.map((m) => `- ${m}`).join("\n")}`);
  process.exit(1);
}
console.log(`Conventional commit check passed for ${messages.length} outgoing commits.`);
