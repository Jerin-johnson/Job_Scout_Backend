import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const all = readdirSync("tests").filter((file) => file.endsWith(".test.js"));
const integration = process.argv.includes("--integration");
const files = integration ? all : all.filter((file) => !file.includes(".mongo.integration."));
const extraArgs = integration ? ["--test-concurrency=2"] : [];
// Tests import TypeScript sources through `.js` specifiers, so the tsx loader
// must be registered before the test environment bootstrap (mirrors `npm test`).
const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--import",
    "./tests/test-env.js",
    "--test",
    ...extraArgs,
    ...files.map((file) => `tests/${file}`),
  ],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
