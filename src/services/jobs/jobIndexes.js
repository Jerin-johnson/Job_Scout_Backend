import { Job } from "../../models/Job.js";

/**
 * Remove the legacy globally-unique content hash index. A content hash detects
 * edits to a posting; source-specific identityKey owns uniqueness.
 */
export async function dropObsoleteUniqueContentHashIndex(jobModel = Job) {
  const collectionExists = await jobModel.db.db
    .listCollections({ name: jobModel.collection.collectionName }, { nameOnly: true })
    .hasNext();
  if (!collectionExists) return false;
  const indexes = await jobModel.collection.indexes();
  const obsolete = indexes.find(
    (index) => index.unique && index.key?.contentHash === 1 && Object.keys(index.key).length === 1,
  );
  if (!obsolete) return false;
  await jobModel.collection.dropIndex(obsolete.name);
  return true;
}
