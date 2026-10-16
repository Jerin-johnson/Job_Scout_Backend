import mongoose from "mongoose";
import { connectMongo } from "../src/config/database.js";
import { UsageEvent } from "../src/models/UsageEvent.js";

const days = Math.max(1, Math.min(90, Number.parseInt(process.argv[2] || "30", 10) || 30));
const connected = await connectMongo();
if (!connected) {
  process.stderr.write("MongoDB is unavailable; usage report was not generated.\n");
  process.exitCode = 1;
} else {
  try {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await UsageEvent.aggregate([
      {
        $match: {
          feature: { $in: ["mock_interview", "mock_interview_trial"] },
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } },
            feature: "$feature",
            model: "$model",
          },
          calls: { $sum: 1 },
          costUsd: { $sum: "$costUsd" },
          inputTokens: { $sum: "$inputTokens" },
          outputTokens: { $sum: "$outputTokens" },
          meanLatencyMs: { $avg: "$latencyMs" },
          maxLatencyMs: { $max: "$latencyMs" },
        },
      },
      { $sort: { "_id.day": 1, "_id.feature": 1, "_id.model": 1 } },
    ]);
    process.stdout.write(
      `${JSON.stringify({ since: since.toISOString(), days, rows }, null, 2)}\n`,
    );
  } finally {
    await mongoose.disconnect();
  }
}
