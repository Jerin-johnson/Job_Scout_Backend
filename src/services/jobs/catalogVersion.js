import { JobCatalogVersion } from "../../models/JobCatalogVersion.js";
import { isMongoReady } from "../../config/database.js";

const GLOBAL_CATALOG_KEY = "global";

export async function getCatalogVersion() {
  if (!isMongoReady()) return 1;
  const state = await JobCatalogVersion.findOne({ key: GLOBAL_CATALOG_KEY }).select("version").lean();
  return Number.isSafeInteger(state?.version) && state.version > 0 ? state.version : 1;
}

export async function bumpCatalogVersion() {
  if (!isMongoReady()) return 1;
  const state = await JobCatalogVersion.findOneAndUpdate(
    { key: GLOBAL_CATALOG_KEY },
    [{ $set: { key: GLOBAL_CATALOG_KEY, version: { $add: [{ $ifNull: ["$version", 1] }, 1] } } }],
    { upsert: true, new: true, projection: { version: 1 } },
  ).lean();
  return state.version;
}
