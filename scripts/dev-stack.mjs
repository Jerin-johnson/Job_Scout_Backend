import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.resolve(backendRoot, "..", "Ai_resume_frontend");
const frontendNext = path.join(frontendRoot, "node_modules", "next", "dist", "bin", "next");

const children = [
  spawn(process.execPath, ["--watch", "src/server.js"], {
    cwd: backendRoot,
    env: { ...process.env, PORT: "4001" },
    stdio: "inherit",
  }),
  spawn(process.execPath, ["--watch", "src/worker.js"], {
    cwd: backendRoot,
    env: { ...process.env },
    stdio: "inherit",
  }),
  spawn(process.execPath, [frontendNext, "dev", "--hostname", "localhost", "--port", "3000"], {
    cwd: frontendRoot,
    env: {
      ...process.env,
      NEXT_PUBLIC_API_BASE_URL: "http://localhost:4001",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    },
    stdio: "inherit",
  }),
];

let stopping = false;
function stopChildren(signal = "SIGINT") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => stopChildren("SIGINT"));
process.on("SIGTERM", () => stopChildren("SIGTERM"));
for (const child of children) {
  child.on("error", (error) => {
    console.error("A local service could not start:", error.message);
    process.exitCode = 1;
    stopChildren();
  });
  child.on("exit", (code) => {
    if (!stopping && code !== 0) {
      process.exitCode = code || 1;
      stopChildren();
    }
  });
}

console.log(
  "JobScout local stack: API http://localhost:4001, worker (BullMQ), web http://localhost:3000",
);
