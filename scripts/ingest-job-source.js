if (process.env.NODE_ENV === "production") {
  console.error("Source ingestion CLI is disabled in production.");
  process.exit(1);
}

const sourceKey = String(process.argv[2] || "")
  .trim()
  .toLowerCase();
if (!/^(remoteok|remotive|jobicy)$/.test(sourceKey)) {
  console.error("Usage: npm run jobs:ingest:source -- <remoteok|remotive|jobicy>");
  process.exit(2);
}

const [{ connectMongo, disconnectMongo, isMongoReady }, { jobIngestionService }] =
  await Promise.all([
    import("../src/infrastructure/database/database.js"),
    import("../src/infrastructure/external-services/jobs/ingestion/JobIngestionEngine.js"),
  ]);
await connectMongo();
if (!isMongoReady()) {
  console.error("MongoDB is required for source ingestion; no in-memory ingestion was performed.");
  process.exit(1);
}
try {
  await jobIngestionService.ensureSources();
  const result = await jobIngestionService.ingestSource(sourceKey);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.errors ? 1 : 0;
} finally {
  await disconnectMongo();
}
