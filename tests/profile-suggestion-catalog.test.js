import test from "node:test";
import assert from "node:assert/strict";
import {
  ISO_SUBDIVISION_CODES,
  PLACE_SUGGESTIONS,
  normalizeSuggestionQuery,
  resolvePlacePair,
  suggestPlaces,
  suggestRoles,
} from "../src/services/profileSuggestionCatalog.js";
import { careerProfileSchema } from "../src/presentation/http/controllers/profileController.js";
import { profileController } from "../src/presentation/http/controllers/profileController.js";
import { normalizeRoleForMatching } from "../src/services/jobs/roleNormalization.js";

function apiResponse() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

test("role suggestions cover approved India-first and non-IT roles with exact normalized aliases", () => {
  assert.ok(suggestRoles("gnm").some((role) => role.label === "GNM Nurse"));
  assert.ok(suggestRoles("sales representative").some((role) => role.label === "Sales Executive"));
  assert.ok(suggestRoles("delivery").some((role) => role.label === "Delivery Executive"));
  assert.equal(normalizeSuggestionQuery("  TRICHŪR, Kerala! "), "trichur kerala");
  assert.ok(suggestRoles("sofware enginer").some((role) => role.label === "Software Engineer"));
  assert.equal(normalizeRoleForMatching("Business Analyst"), "Business Analyst");
  assert.equal(normalizeRoleForMatching("Data Analyst"), "Data Analyst");
});

test("place aliases resolve exact city and consistent Kerala pair without fuzzy matching", () => {
  const kochi = resolvePlacePair("Kochi, Kerala").suggestions;
  assert.equal(kochi.length, 1);
  assert.equal(kochi[0].code, "in-kerala-kochi");
  assert.equal(resolvePlacePair("Kochi, Texas").suggestions.length, 0);
  assert.ok(suggestPlaces("Trivandrum").some((place) => place.label === "Thiruvananthapuram"));
  assert.equal(
    suggestPlaces("Kochx").some((place) => place.label === "Kochi"),
    false,
  );
});

test("ambiguous place names require confirmation, while explicit remote phrases are not parsed as places", () => {
  const ambiguous = resolvePlacePair("Hyderabad, Telangana");
  assert.equal(ambiguous.needsConfirmation, true);
  assert.equal(ambiguous.question, "Is this in India?");
  assert.equal(suggestPlaces("Remote")[0].code, "remote");
  assert.equal(suggestPlaces("Anywhere in India")[0].code, "anywhere-in-india");
});

test("career profile has no language default and validates ISO subdivisions and city consistency", () => {
  const empty = careerProfileSchema.parse({});
  assert.deepEqual(empty.moreDetails.languages, []);
  assert.ok(
    [...new Set(PLACE_SUGGESTIONS.map((place) => place.subdivisionCode).filter(Boolean))].every(
      (code) => ISO_SUBDIVISION_CODES.has(code),
    ),
  );
  assert.equal(
    careerProfileSchema.safeParse({
      homeLocation: { countryCode: "IN", subdivisionCode: "IN-KL", cityCode: "in-kerala-kochi" },
    }).success,
    true,
  );
  assert.equal(
    careerProfileSchema.safeParse({
      homeLocation: { countryCode: "US", subdivisionCode: null, cityCode: "in-kerala-kochi" },
    }).success,
    false,
  );
  const newFields = careerProfileSchema.parse({
    experience: { isFresher: true },
    targetLocations: [{ scope: "anywhere_in_india" }],
  });
  assert.equal(newFields.experience.isFresher, true);
  assert.equal(newFields.targetLocations[0].scope, "anywhere_in_india");
});

test("suggestion handlers return ETag responses, consistent pair suggestions, and ambiguity prompts", async () => {
  const roleResponse = apiResponse();
  await profileController.roleSuggestions(
    { query: { q: "nurse" }, get: () => undefined },
    roleResponse,
    assert.fail,
  );
  assert.equal(roleResponse.statusCode, 200);
  assert.ok(roleResponse.headers.ETag);
  assert.equal(roleResponse.body.data.suggestions[0].label, "Staff Nurse");

  const placeResponse = apiResponse();
  await profileController.placeSuggestions(
    { query: { q: "Kochi, Texas" }, get: () => undefined },
    placeResponse,
    assert.fail,
  );
  assert.deepEqual(placeResponse.body.data.suggestions, []);

  const ambiguousResponse = apiResponse();
  await profileController.placeSuggestions(
    { query: { q: "Hyderabad" }, get: () => undefined },
    ambiguousResponse,
    assert.fail,
  );
  assert.equal(ambiguousResponse.body.data.needsConfirmation, true);
  assert.equal(ambiguousResponse.body.data.confirmationQuestion, "Is this in India?");
});
