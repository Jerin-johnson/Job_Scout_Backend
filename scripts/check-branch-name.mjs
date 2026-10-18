import { execFileSync } from "node:child_process";

const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
const allowed = /^(main|development|feat|fix|chore|docs|refactor|perf|test|ci)\/[a-z0-9][a-z0-9._/-]*$|^(main|development)$/;
if (!allowed.test(branch) || branch.includes("..") || branch.endsWith("/")) {
  console.error("Branch name must be main, development, or use an approved prefix (feat/fix/chore/docs/refactor/perf/test/ci). No branch name was accepted.");
  process.exit(1);
}
