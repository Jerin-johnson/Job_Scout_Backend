import { execFileSync, spawnSync } from "node:child_process";

const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
if (branch !== "main") process.exit(0);
const remoteBase = process.env.VERIFY_BASE_REF || "origin/main";
let commits;
try { commits = execFileSync("git", ["rev-list", "--first-parent", `${remoteBase}..HEAD`], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean); }
catch { console.error("Cannot verify main push ancestry. Fetch origin/main and retry."); process.exit(1); }
if (!commits.length) process.exit(0);
const dev = "development";
for (const hash of commits) {
  const parents = execFileSync("git", ["show", "-s", "--format=%P", hash], { encoding: "utf8" }).trim().split(" ");
  if (parents.length < 2) {
    console.error("Direct pushes to main are blocked. Push a reviewed merge commit from development or an approved hotfix flow.");
    process.exit(1);
  }
  const fromDevelopment = spawnSync("git", ["merge-base", "--is-ancestor", parents[1], dev], { stdio: "ignore" });
  if (fromDevelopment.status !== 0) {
    console.error("A main merge must have its second parent reachable from development.");
    process.exit(1);
  }
}
