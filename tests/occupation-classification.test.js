import test from "node:test";
import assert from "node:assert/strict";
import { classifyJobOccupation, OCCUPATION_FEATURES_VERSION } from "../src/services/jobs/occupationClassification.js";

test("classifies normalized title families with deterministic rules", () => {
  const cases = [
    ["Senior Staff Nurse", "nursing", "Staff Nurse"],
    ["Business Analyst", "business", "Business Analyst"],
    ["Delivery Associate", "delivery-logistics", "Delivery Executive"],
    ["Accountant", "accounting-finance", "Accountant"],
    ["Data Analyst", "data", "Data Analyst"],
    ["Electrician", "electrical-trades", "Electrician"],
    ["Architectural Designer", "design", "Product Designer"],
    ["Product Design Director", "design", "Product Designer"],
    ["Software Deployment Engineer", "software", "Software Engineer"],
    ["Customer Success Advisor", "customer-support", "Customer Support"],
  ];
  for (const [title, family, normalizedTitle] of cases) {
    assert.deepEqual(classifyJobOccupation({ title }), {
      occupation: family, occupationConfidence: 0.95, normalizedTitle, occupationFeaturesVersion: OCCUPATION_FEATURES_VERSION,
    });
  }
});

test("uses source category before marking a job unclassified", () => {
  assert.equal(classifyJobOccupation({ title: "Associate II", sourceCategory: "Nursing & Clinical Care" }).occupation, "nursing");
  assert.equal(classifyJobOccupation({ title: "Unique Role" }).occupation, "unclassified");
});

test("classification is idempotent", () => {
  const job = { title: "Registered Nurse" };
  assert.deepEqual(classifyJobOccupation(job), classifyJobOccupation(job));
});
