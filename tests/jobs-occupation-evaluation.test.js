import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { summarizeOccupationLabels } from "../src/services/jobs/occupationEvaluation.js";
import { classifyJobOccupation } from "../src/services/jobs/occupationClassification.js";

test("occupation accuracy summarizes per-predicted-family precision and per-gold-family recall", () => {
  const result = summarizeOccupationLabels([
    { predicted: "software", gold: "software" },
    { predicted: "software", gold: "data" },
    { predicted: "unclassified", gold: "unclassified" },
  ]);
  assert.equal(result.accuracy, 0.6667);
  assert.equal(result.unclassifiedShare, 0.3333);
  assert.deepEqual(result.precisionByPredictedFamily.software, {
    predicted: 2,
    correct: 1,
    precision: 0.5,
  });
  assert.deepEqual(result.recallByGoldFamily.software, {
    support: 1,
    correct: 1,
    recall: 1,
  });
  assert.deepEqual(result.recallByGoldFamily.data, {
    support: 1,
    correct: 0,
    recall: 0,
  });
  assert.equal(result.precisionByPredictedFamily.unclassified.precision, 1);
});

test("O*NET-augmented occupation classifier achieves >= 95% accuracy and < 5% unclassified share on the 100-title gold fixture", async () => {
  const gold = JSON.parse(
    await readFile(
      new URL("../scripts/fixtures/occupation-gold-100.json", import.meta.url),
      "utf8",
    ),
  );
  const rows = gold.map(([title, goldFamily]) => ({
    predicted: classifyJobOccupation({ title }).occupation,
    gold: goldFamily,
  }));
  const summary = summarizeOccupationLabels(rows);
  assert.ok(summary.accuracy >= 0.95, `Expected accuracy >= 0.95, got ${summary.accuracy}`);
  assert.ok(
    summary.macroPrecision >= 0.95,
    `Expected macroPrecision >= 0.95, got ${summary.macroPrecision}`,
  );
  assert.ok(
    summary.macroRecall >= 0.95,
    `Expected macroRecall >= 0.95, got ${summary.macroRecall}`,
  );
  assert.ok(
    summary.unclassifiedShare <= 0.05,
    `Expected unclassifiedShare <= 0.05, got ${summary.unclassifiedShare}`,
  );
});
