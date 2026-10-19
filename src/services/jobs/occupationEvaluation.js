export function summarizeOccupationLabels(rows) {
  const totals = new Map();
  const goldTotals = new Map();
  let correct = 0;
  let unclassifiedCount = 0;
  for (const row of rows) {
    const predicted = row.predicted || "unclassified";
    const gold = row.gold || "unclassified";
    if (predicted === "unclassified") unclassifiedCount += 1;
    const current = totals.get(predicted) || { predicted: 0, correct: 0 };
    current.predicted += 1;
    if (predicted === gold) {
      current.correct += 1;
      correct += 1;
    }
    totals.set(predicted, current);

    const goldEntry = goldTotals.get(gold) || { support: 0, correct: 0 };
    goldEntry.support += 1;
    if (predicted === gold) goldEntry.correct += 1;
    goldTotals.set(gold, goldEntry);
  }
  const precisionByPredictedFamily = Object.fromEntries(
    [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([family, counts]) => [
        family,
        {
          ...counts,
          precision: counts.predicted
            ? Number((counts.correct / counts.predicted).toFixed(4))
            : null,
        },
      ]),
  );
  const recallByGoldFamily = Object.fromEntries(
    [...goldTotals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([family, counts]) => [
        family,
        {
          ...counts,
          recall: counts.support ? Number((counts.correct / counts.support).toFixed(4)) : null,
        },
      ]),
  );
  const nonUnclassifiedPrecisions = Object.entries(precisionByPredictedFamily)
    .filter(([family, entry]) => family !== "unclassified" && typeof entry.precision === "number")
    .map(([, entry]) => entry.precision);
  const nonUnclassifiedRecalls = Object.entries(recallByGoldFamily)
    .filter(([family, entry]) => family !== "unclassified" && typeof entry.recall === "number")
    .map(([, entry]) => entry.recall);

  return {
    sampleSize: rows.length,
    accuracy: rows.length ? Number((correct / rows.length).toFixed(4)) : null,
    unclassifiedCount,
    unclassifiedShare: rows.length ? Number((unclassifiedCount / rows.length).toFixed(4)) : null,
    macroPrecision: nonUnclassifiedPrecisions.length
      ? Number(
          (
            nonUnclassifiedPrecisions.reduce((sum, val) => sum + val, 0) /
            nonUnclassifiedPrecisions.length
          ).toFixed(4),
        )
      : null,
    macroRecall: nonUnclassifiedRecalls.length
      ? Number(
          (
            nonUnclassifiedRecalls.reduce((sum, val) => sum + val, 0) /
            nonUnclassifiedRecalls.length
          ).toFixed(4),
        )
      : null,
    precisionByPredictedFamily,
    recallByGoldFamily,
  };
}
