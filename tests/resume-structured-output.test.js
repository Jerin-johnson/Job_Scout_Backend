import test from "node:test";
import assert from "node:assert/strict";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { executeModelCall } from "../src/ai/llm.js";
import { extractedFactsSchema } from "../src/services/resumeParserService.js";
import { parseExperienceRoles } from "../src/services/resumeRoleParser.js";

test("model invocation omits a null AbortSignal and forwards a real signal", async () => {
  const calls = [];
  const model = {
    async invoke(messages, options) {
      calls.push({ messages, options });
      return "ok";
    },
  };
  const messages = [{ role: "user", content: "hello" }];

  assert.equal(await executeModelCall({ model, messages, signal: null }), "ok");
  assert.deepEqual(calls[0].options, {});

  const signal = new AbortController().signal;
  await executeModelCall({ model, messages, signal });
  assert.equal(calls[1].options.signal, signal);
});

test("resume extraction schema uses required properties for strict provider output", () => {
  const schema = toJsonSchema(extractedFactsSchema);
  function assertRequiredProperties(node, path = "root") {
    if (node.type === "array") {
      assertRequiredProperties(node.items, `${path}[]`);
      return;
    }
    if (node.type !== "object") return;
    assert.deepEqual(
      [...node.required].sort(),
      Object.keys(node.properties).sort(),
      `${path} must require every property for strict structured output`,
    );
    for (const [name, property] of Object.entries(node.properties)) {
      assertRequiredProperties(property, `${path}.${name}`);
    }
  }

  assertRequiredProperties(schema);
  assert.deepEqual(schema.properties.roles.items.properties.startDate.type, ["string", "null"]);
});

test("deterministic role parser handles reverse-chronological experience", () => {
  const roles = parseExperienceRoles(`PROFILE
EXPERIENCE
Senior Software Engineer
Acme Technologies
Jan 2022 - Present
- Built platform services
Software Developer
Beta Solutions
June 2019 - Dec 2021
EDUCATION
Bachelor of Engineering`);
  assert.deepEqual(roles.map(({ title, company, isCurrent }) => ({ title, company, isCurrent })), [
    { title: "Senior Software Engineer", company: "Acme Technologies", isCurrent: true },
    { title: "Software Developer", company: "Beta Solutions", isCurrent: false },
  ]);
});

test("deterministic role parser extracts fresher internship without inventing employment", () => {
  const roles = parseExperienceRoles(`INTERNSHIP EXPERIENCE
Frontend Developer Intern
Northstar Technologies
Jan 2025 - Apr 2025
EDUCATION
Bachelor of Computer Applications`);
  assert.equal(roles.length, 1);
  assert.equal(roles[0].title, "Frontend Developer Intern");
  assert.equal(roles[0].company, "Northstar Technologies");
});

test("deterministic role parser handles nursing title, hospital and ward lines", () => {
  const roles = parseExperienceRoles(`CLINICAL EXPERIENCE
Staff Nurse
ICU Ward
St Mary's Hospital
Feb 2021 - Present
EDUCATION
General Nursing and Midwifery`);
  assert.equal(roles.length, 1);
  assert.equal(roles[0].title, "Staff Nurse");
  assert.equal(roles[0].company, "St Mary's Hospital");
});
