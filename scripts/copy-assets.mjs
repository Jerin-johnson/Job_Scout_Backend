import fs from "node:fs";
import path from "node:path";

const src = "src/domain/services/jobs/referenceData";
const dst = "dist/src/domain/services/jobs/referenceData";

if (fs.existsSync(src)) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src).filter((x) => x.endsWith(".json"))) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}
