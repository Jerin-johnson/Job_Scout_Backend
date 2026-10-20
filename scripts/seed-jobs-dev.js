if (process.env.NODE_ENV === "production") {
  console.error("Development job fixtures are disabled in production.");
  process.exit(1);
}
if (process.argv[2] !== "--confirm-dev-fixtures") {
  console.error(
    "Pass --confirm-dev-fixtures to insert synthetic sample jobs into the configured development database.",
  );
  process.exit(2);
}

const [{ connectMongo }, { Job }, { JobSource }, { embeddingService }] = await Promise.all([
  import("../src/infrastructure/database/database.js"),
  import("../src/infrastructure/database/mongoose/models/JobModel.js"),
  import("../src/infrastructure/database/mongoose/models/JobSourceModel.js"),
  import("../src/infrastructure/ai/embeddingService.js"),
]);
await connectMongo();
const source = {
  key: "dev-fixtures",
  displayName: "Sample jobs (development only)",
  adapterModule: "mockBoardAdapter.js",
  enabled: true,
  approved: true,
  termsUrl: "https://example.invalid/development-fixtures",
  attributionText: "Synthetic development fixtures",
  attributionUrl: "https://example.invalid/",
  retentionDays: 3650,
  staleAfterDays: 3650,
  termsVerifiedAt: new Date("2026-10-16T00:00:00.000Z"),
  quota: { requestsPerDay: 1, intervalMs: 86400000, timeoutMs: 1000, maxRetries: 0 },
};
await JobSource.findOneAndUpdate({ key: source.key }, { $setOnInsert: source }, { upsert: true });

const roles = [
  ["Staff Nurse", "Kochi", "IN", "INR", 420000, 720000],
  ["ICU Nurse", "Thiruvananthapuram", "IN", "INR", 520000, 840000],
  ["School Teacher", "Bengaluru", "IN", "INR", 480000, 900000],
  ["Accountant", "Mumbai", "IN", "INR", 600000, 1050000],
  ["Backend Developer", "Kochi", "IN", "INR", 1200000, 2400000],
  ["Frontend Developer", "Bengaluru", "IN", "INR", 1100000, 2200000],
  ["Data Analyst", "Mumbai", "IN", "INR", 900000, 1800000],
  ["Sales Executive", "Dubai", "AE", "AED", 90000, 180000],
  ["Operations Associate", "London", "GB", "GBP", 28000, 46000],
  ["Delivery Associate", "Remote", "", "USD", 36000, 54000],
];
const titles = [
  ...roles,
  ...roles,
  ...roles,
  ...roles,
  ...roles,
  ...roles,
  ...roles,
  ...roles,
  ...roles,
  ...roles,
  ...roles,
  ...roles,
  ...roles,
  ...roles,
  ...roles,
  ...roles,
  ...roles,
];
const config = embeddingService.getConfig();
const vector = Array.from({ length: config.dimension }, () => 0);
const now = Date.now();
const jobs = titles.slice(0, 180).map(([title, city, countryCode, currency, min, max], index) => {
  const key = `fixture-${String(index + 1).padStart(3, "0")}`;
  const places = [
    "Kochi",
    "Thiruvananthapuram",
    "Bengaluru",
    "Mumbai",
    "Dubai",
    "London",
    "Remote",
  ];
  const location = index % 7 === 6 ? "Remote · Worldwide" : city;
  const country = location.startsWith("Remote") ? "" : countryCode;
  const remoteScope = location.startsWith("Remote")
    ? index % 2
      ? "worldwide"
      : "unknown"
    : "city";
  return {
    contentHash: `dev-fixture-content-${key}`,
    identityKey: `dev-fixture:${key}`,
    sourceJobId: key,
    canonicalUrl: `https://example.invalid/dev-fixtures/${key}`,
    title,
    company: `Sample ${title} Company ${index + 1}`,
    location: location || places[index % places.length],
    structuredLocation: {
      countryCode: country,
      city,
      remoteScope,
      eligibleCountryCodes: index % 3 ? [country || "IN"].filter(Boolean) : [],
    },
    remoteType:
      location.startsWith("Remote") || index % 4 === 0
        ? "remote"
        : index % 4 === 1
          ? "hybrid"
          : "onsite",
    salaryRange: { min, max, currency },
    compensation: {
      originalText: `${min.toLocaleString()}–${max.toLocaleString()} ${currency}`,
      currency,
      payPeriod: "year",
      min,
      max,
    },
    requirements: ["communication", "teamwork", "problem solving"],
    tags: [title.toLowerCase()],
    rawDescription: `Synthetic development role: ${title}. Not a real job opening.`,
    sourceBoard: source.key,
    sourceUrl: `https://example.invalid/dev-fixtures/${key}`,
    postedAt: new Date(now - (index % 90) * 86400000),
    postedDateKnown: true,
    expiresAt: new Date(now + 30 * 86400000),
    status: "active",
    embedding: vector,
    embeddingMetadata: {
      provider: config.provider,
      model: config.model,
      dimension: config.dimension,
    },
  };
});
await Job.bulkWrite(
  jobs.map((job) => ({
    updateOne: {
      filter: { identityKey: job.identityKey },
      update: { $setOnInsert: job },
      upsert: true,
    },
  })),
  { ordered: false },
);
console.log(
  JSON.stringify(
    { insertedOrPresent: jobs.length, source: source.key, syntheticOnly: true },
    null,
    2,
  ),
);
process.exit(0);
