import { Job } from "../models/JobModel.js";

/**
 * Remove the legacy globally-unique content hash index. A content hash detects
 * edits to a posting; source-specific identityKey owns uniqueness.
 */
export async function dropObsoleteUniqueContentHashIndex(jobModel = Job): Promise<boolean> {
  if (!jobModel.db?.db) return false;
  const collectionExists = await jobModel.db.db
    .listCollections({ name: jobModel.collection.collectionName }, { nameOnly: true })
    .hasNext();
  if (!collectionExists) return false;
  const indexes = await jobModel.collection.indexes();
  const obsolete = indexes.find(
    (index) =>
      index.unique &&
      (index.key as Record<string, unknown>)?.contentHash === 1 &&
      Object.keys(index.key as Record<string, unknown>).length === 1,
  );
  if (!obsolete?.name) return false;
  await jobModel.collection.dropIndex(obsolete.name);
  return true;
}
