import { connectMongo, disconnectMongo } from "../src/config/database.js";
import { Resume } from "../src/infrastructure/database/mongoose/models/ResumeModel.js";
import { decryptText } from "../src/shared/utils/crypto.js";
import {
  getExperienceSectionMetrics,
  parseExperienceRoles,
} from "../src/services/resumeRoleParser.js";

try {
  await connectMongo();
  const resumes = await Resume.collection
    .find(
      {},
      {
        projection: { encryptedRawText: 1, factsSummary: 1 },
      },
    )
    .toArray();
  let parsedRoleCount = 0;
  let recordsWithExperienceHeading = 0;
  const findings = [];
  for (const resume of resumes) {
    let text = "";
    let decryptionStatus = "missing_payload";
    if (
      resume.encryptedRawText?.cipherText &&
      resume.encryptedRawText?.iv &&
      resume.encryptedRawText?.tag
    ) {
      try {
        text = decryptText(resume.encryptedRawText);
        decryptionStatus = "decrypted";
      } catch {
        decryptionStatus = "authentication_failed";
      }
    }
    const roles = parseExperienceRoles(text);
    parsedRoleCount += roles.length;
    if (/\b(experience|employment history|internships?)\b/i.test(text))
      recordsWithExperienceHeading += 1;
    findings.push({
      status: text ? "readable" : "unreadable",
      decryptionStatus,
      keyVersion: resume.encryptedRawText?.keyVersion || "missing",
      experienceHeading: /\b(experience|employment history|internships?)\b/i.test(text),
      existingRoleCount: Number(resume.factsSummary?.roles || 0),
      deterministicRoleCount: roles.length,
      parserMetrics: getExperienceSectionMetrics(text),
    });
  }
  console.log(
    JSON.stringify(
      {
        mode: "read-only",
        resumeCount: resumes.length,
        recordsWithExperienceHeading,
        deterministicRoleCount: parsedRoleCount,
        findings,
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    "Could not produce the read-only resume role report. Check local MongoDB availability and resume decryption configuration.",
  );
  process.exitCode = 1;
} finally {
  await disconnectMongo().catch(() => {});
}
