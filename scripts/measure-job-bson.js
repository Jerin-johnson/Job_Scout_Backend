import mongoose from "mongoose";
import { connectMongo, disconnectMongo, isMongoReady } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { Job } from "../src/models/Job.js";

const hostname = new URL(env.MONGODB_URI).hostname;
if (env.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(hostname)) throw new Error("BSON size measurement is read-only and limited to loopback MongoDB.");
await connectMongo();
try {
  if (!isMongoReady()) throw new Error("Local MongoDB is unavailable.");
  const collection = Job.collection;
  const total = await Job.countDocuments({});
  const sampled = await Job.find({}).sort({ _id: 1 }).limit(100).lean();
  const calculateObjectSize = mongoose.mongo.BSON.calculateObjectSize;
  const bytesWithEmbeddings = sampled.map((job) => calculateObjectSize(job));
  const bytesWithoutEmbeddings = sampled.map((job) => {
    const fields = { ...job };
    delete fields.embedding;
    delete fields.embeddingMetadata;
    return calculateObjectSize(fields);
  });
  const fieldByteTotals = {};
  for (const job of sampled) {
    const fullSize = calculateObjectSize(job);
    for (const field of Object.keys(job)) {
      const copy = { ...job }; delete copy[field];
      fieldByteTotals[field] = (fieldByteTotals[field] || 0) + fullSize - calculateObjectSize(copy);
    }
  }
  const fieldBytes = Object.fromEntries(Object.entries(fieldByteTotals).map(([field, totalBytes]) => [field, Math.round(totalBytes / sampled.length)]));
  const stats = await Job.db.db.command({ collStats: collection.name }).catch(() => null);
  const mean = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const withVectors = mean(bytesWithEmbeddings);
  const noVectors = mean(bytesWithoutEmbeddings);
  console.log(JSON.stringify({ mode: "read-only", totalJobs: total, sampleSize: sampled.length, bsonAverageBytesWithLegacyVectors: withVectors, bsonAverageBytesWithoutVectors: noVectors, averageVectorMetadataBytes: mean(sampled.map((job) => calculateObjectSize({ embedding: job.embedding || [], embeddingMetadata: job.embeddingMetadata || {} }))), averageFieldBytes: fieldBytes, storage: stats ? { count: stats.count, size: stats.size, storageSize: stats.storageSize, totalIndexSize: stats.totalIndexSize, indexSizes: stats.indexSizes || null } : null, extrapolatedDataBytes: { at10k: { withLegacyVectors: withVectors * 10000, embeddingsOffNewRecords: noVectors * 10000 }, at100k: { withLegacyVectors: withVectors * 100000, embeddingsOffNewRecords: noVectors * 100000 }, at1m: { withLegacyVectors: withVectors * 1000000, embeddingsOffNewRecords: noVectors * 1000000 } } }, null, 2));
} finally { await disconnectMongo(); }
