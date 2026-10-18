import test from "node:test";
import assert from "node:assert/strict";
import { summarizeOccupationLabels } from "../src/services/jobs/occupationEvaluation.js";

test("occupation accuracy summarizes per-predicted-family precision", () => {
  const result = summarizeOccupationLabels([
    { predicted: "software", gold: "software" },
    { predicted: "software", gold: "data" },
    { predicted: "unclassified", gold: "unclassified" },
  ]);
  assert.equal(result.accuracy, 0.6667);
  assert.deepEqual(result.precisionByPredictedFamily.software, { predicted: 2, correct: 1, precision: 0.5 });
  assert.equal(result.precisionByPredictedFamily.unclassified.precision, 1);
});
