import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyJobOccupation,
  OCCUPATION_FEATURES_VERSION,
} from "../src/services/jobs/occupationClassification.js";
import {
  getReferenceDataAttributions,
  lookupGeoNamesPlace,
} from "../src/services/jobs/referenceData/index.js";

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
    ["Enterprise Account Executive - EMEA", "sales", "Sales Executive"],
    ["Principal macOS Security Researcher", "security", "Security Specialist"],
    ["RevOps Analyst", "operations", "Operations Associate"],
  ];
  for (const [title, family, normalizedTitle] of cases) {
    assert.deepEqual(classifyJobOccupation({ title }), {
      occupation: family,
      occupationConfidence: 0.95,
      normalizedTitle,
      occupationFeaturesVersion: OCCUPATION_FEATURES_VERSION,
    });
  }
});

test("uses source category before marking a job unclassified", () => {
  assert.equal(
    classifyJobOccupation({ title: "Associate II", sourceCategory: "Nursing & Clinical Care" })
      .occupation,
    "nursing",
  );
  assert.equal(classifyJobOccupation({ title: "Unique Role" }).occupation, "unclassified");
});

test("normalizes European diacritics and recognizes multilingual non-IT categories", () => {
  const cases = [
    [{ title: "Infirmière diplômée" }, "nursing"],
    [{ title: "Comptable fournisseurs" }, "accounting-finance"],
    [{ title: "Sjuksköterska" }, "nursing"],
    [{ title: "Redovisningsekonom" }, "accounting-finance"],
    [{ title: "Associate II", sourceCategory: "Gesundheitswesen / Krankenpflege" }, "nursing"],
    [{ title: "Associate II", categories: ["Comptabilité"] }, "accounting-finance"],
    [{ title: "Associate II", tags: ["Logistik"] }, "delivery-logistics"],
    [{ title: "Cuisinière" }, "food-hospitality"],
    [{ title: "Enseñante" }, "education"],
    [{ title: "Carpintero" }, "construction-trades"],
  ];
  for (const [job, expected] of cases) {
    assert.equal(classifyJobOccupation(job).occupation, expected, JSON.stringify(job));
    assert.equal(classifyJobOccupation(job).occupationFeaturesVersion, OCCUPATION_FEATURES_VERSION);
  }
});

test("keeps unrelated multilingual titles unclassified instead of guessing", () => {
  assert.equal(
    classifyJobOccupation({ title: "Responsable polyvalent" }).occupation,
    "unclassified",
  );
  assert.equal(classifyJobOccupation({ title: "Mitarbeiter" }).occupation, "unclassified");
});

test("classification is idempotent", () => {
  const job = { title: "Registered Nurse" };
  assert.deepEqual(classifyJobOccupation(job), classifyJobOccupation(job));
});

test("O*NET and GeoNames subsets carry CC BY 4.0 attribution and resolve priority places", () => {
  const attributions = getReferenceDataAttributions();
  assert.equal(attributions.length, 2);
  assert.ok(attributions.every((item) => item.license === "CC BY 4.0"));
  assert.ok(attributions[0].attribution.includes("O*NET"));
  assert.ok(attributions[1].attribution.includes("GeoNames"));

  const kochi = lookupGeoNamesPlace("Infopark Kakkanad, Ernakulam");
  assert.equal(kochi?.city, "Kochi");
  assert.equal(kochi?.region, "Kerala");
  assert.equal(kochi?.countryCode, "IN");

  const dubai = lookupGeoNamesPlace("Dubai Healthcare City, UAE");
  assert.equal(dubai?.city, "Dubai");
  assert.equal(dubai?.countryCode, "AE");
});
