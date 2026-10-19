import { spawnSync } from "node:child_process";

const mode = process.argv[2] === "release" ? "release" : "push";
function run(command, args, env = process.env) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const useShell = process.platform === "win32" && command !== process.execPath;
  const result = spawnSync(command, args, { stdio: "inherit", env, shell: useShell });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("npm", ["run", "lint"]);
run(process.execPath, ["scripts/run-tests.mjs"]);
run("npm", ["run", "docs:check"]);
run(process.execPath, ["scripts/scan-secrets.mjs", "outgoing"]);
run(process.execPath, ["scripts/check-branch-name.mjs"]);
run(process.execPath, ["scripts/check-commits.mjs"]);
run(process.execPath, ["scripts/check-main-push.mjs"]);
if (mode === "release") {
  if (process.env.VERIFY_SKIP_INTEGRATION === "1" && process.env.VERIFY_SKIP_REASON?.trim()) {
    console.log(`INTEGRATION SKIPPED BY OWNER: ${process.env.VERIFY_SKIP_REASON.trim()}`);
  } else {
    run(process.execPath, ["scripts/run-tests.mjs", "--integration"]);
    run("npm", ["run", "smoke:compose"]);
  }
  if (process.env.VERIFY_SKIP_AUDIT === "1" && process.env.VERIFY_SKIP_REASON?.trim()) {
    console.log(`AUDIT SKIPPED BY OWNER: ${process.env.VERIFY_SKIP_REASON.trim()}`);
  } else run("npm", ["audit", "--omit=dev", "--audit-level=high"]);
}
