import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("generated OpenAPI documents the resume-match frontend contract", async () => {
  const spec = JSON.parse(await readFile(new URL("../openapi.json", import.meta.url), "utf8"));
  assert.ok(spec.paths["/api/v1/resume-match/reports"].get);
  assert.ok(spec.paths["/api/v1/resume-match/reports"].post);
  assert.ok(spec.paths["/api/v1/resume-match/reports/{id}"].get);
  assert.ok(spec.paths["/api/v1/resume-match/reports/{id}"].delete);
  assert.ok(spec.paths["/api/v1/resume-match/reports/{id}/ignored-keywords"].patch);
  assert.ok(spec.paths["/api/v1/resume-match/reports/{id}/suggestions"].post);
  assert.equal(
    spec.paths["/api/v1/resume-match/reports/{id}/ignored-keywords"].patch.requestBody.content[
      "application/json"
    ].schema.required.includes("keyword"),
    true,
  );
  assert.equal(
    spec.paths["/api/v1/resume-match/reports/{id}"].delete.responses[200].description.includes(
      "deleted=true",
    ),
    true,
  );
});
