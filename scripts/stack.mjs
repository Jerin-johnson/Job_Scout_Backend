import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compose = path.join(root, "docker-compose.dev.yml");
const project = "jobscout-local-dev";
function docker(args, allowFailure = false) {
  const result = spawnSync("docker", ["compose", "-p", project, "-f", compose, ...args], { stdio: "inherit", cwd: root, shell: false });
  if (result.error) throw new Error("Docker Compose is unavailable. Install/start Docker Desktop, then retry.");
  if (!allowFailure && result.status !== 0) process.exit(result.status ?? 1);
  return result.status ?? 1;
}

const action = process.argv[2];
if (action === "up") docker(["up", "-d", "--wait"]);
else if (action === "down") docker(["down"]);
else if (action === "smoke") {
  docker(["up", "-d", "--wait"]);
  docker(["exec", "-e", "JOBSCOUT_LOCAL_COMPOSE=1", "-e", "SMOKE_EXTERNAL_API=1", "api", "node", "scripts/smoke.js"]);
} else {
  console.error("Usage: node scripts/stack.mjs <up|down|smoke>");
  process.exit(2);
}
