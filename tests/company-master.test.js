import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompanyName } from "../src/infrastructure/database/mongoose/models/CompanyModel.js";

test("company normalization is stable across casing and punctuation", () => {
  assert.equal(normalizeCompanyName(" Acme, Inc. "), "acme inc");
  assert.equal(normalizeCompanyName("R&D  India"), "r and d india");
  assert.equal(normalizeCompanyName("École Santé"), "école santé");
  assert.equal(normalizeCompanyName("Hims &#038; Hers"), "hims and hers");
});
