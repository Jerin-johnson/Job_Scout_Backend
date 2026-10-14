import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../src/shared/utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function generateOpenApi() {
  logger.info("Generating openapi.json from Zod schemas...");

  const openApiDoc = {
    openapi: "3.1.0",
    info: {
      title: "JobScout Backend API",
      version: "1.0.0",
      description: "Production API for JobScout AI Job-Hunt Agent",
    },
    servers: [
      { url: "http://localhost:4000", description: "Local development server" },
      { url: "https://api.jobscout.ai", description: "Production server" },
    ],
    paths: {
      "/health/live": {
        get: {
          summary: "Liveness probe",
          responses: { 200: { description: "Process is running" } },
        },
      },
      "/health/ready": {
        get: {
          summary: "Readiness probe",
          responses: {
            200: { description: "All dependencies connected" },
            503: { description: "One or more dependencies unavailable" },
          },
        },
      },
    },
  };

  const outputPath = path.resolve(__dirname, "../openapi.json");
  await fs.writeFile(outputPath, JSON.stringify(openApiDoc, null, 2), "utf8");
  logger.info(`OpenAPI spec successfully written to ${outputPath}`);
}

generateOpenApi().catch((err) => {
  logger.error({ err: err.message }, "Error generating OpenAPI spec");
  process.exit(1);
});
