export function summarizeOccupationLabels(rows) {
  const totals = new Map();
  let correct = 0;
  for (const row of rows) {
    const predicted = row.predicted || "unclassified";
    const gold = row.gold || "unclassified";
    const current = totals.get(predicted) || { predicted: 0, correct: 0 };
    current.predicted += 1;
    if (predicted === gold) { current.correct += 1; correct += 1; }
    totals.set(predicted, current);
  }
  return {
    sampleSize: rows.length,
    accuracy: rows.length ? Number((correct / rows.length).toFixed(4)) : null,
    precisionByPredictedFamily: Object.fromEntries([...totals].sort(([a], [b]) => a.localeCompare(b)).map(([family, counts]) => [family, { ...counts, precision: counts.predicted ? Number((counts.correct / counts.predicted).toFixed(4)) : null }])),
  };
}
