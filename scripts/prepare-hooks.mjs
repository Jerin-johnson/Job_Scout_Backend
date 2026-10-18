import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const huskyBin = fileURLToPath(new URL("../node_modules/husky/bin.mjs", import.meta.url));
try {
  await access(huskyBin);
  const child = spawn(process.execPath, [huskyBin], { stdio: "inherit", shell: false });
  child.on("exit", (code) => process.exit(code ?? 1));
} catch {
  console.log("Git hooks are prepared but unverified: install the owner-approved Husky packages to activate them.");
}
