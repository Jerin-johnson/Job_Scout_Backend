import { startWorker, scheduleJobIngestion } from "./main/worker.js";

export { startWorker, scheduleJobIngestion };

if (process.env.NODE_ENV !== "test") {
  startWorker().catch((err) => {
    console.error("Failed to start background worker:", err);
    process.exit(1);
  });
}
