import { JobCatalogVersion } from "../../infrastructure/database/mongoose/models/JobCatalogVersionModel.js";
import { isMongoReady } from "../../config/database.js";

const GLOBAL_CATALOG_KEY = "global";

export async function getCatalogVersion(): Promise<number> {
  if (!isMongoReady()) return 1;
  const state = (await JobCatalogVersion.findOne({ key: GLOBAL_CATALOG_KEY })
    .select("version")
    .lean()) as { version?: number } | null;
  return typeof state?.version === "number" &&
    Number.isSafeInteger(state.version) &&
    state.version > 0
    ? state.version
    : 1;
}

export async function bumpCatalogVersion(): Promise<number> {
  if (!isMongoReady()) return 1;
  const state = (await JobCatalogVersion.findOneAndUpdate(
    { key: GLOBAL_CATALOG_KEY },
    [{ $set: { key: GLOBAL_CATALOG_KEY, version: { $add: [{ $ifNull: ["$version", 1] }, 1] } } }],
    { upsert: true, new: true, projection: { version: 1 } },
  ).lean()) as unknown as { version: number };
  return state.version;
}
