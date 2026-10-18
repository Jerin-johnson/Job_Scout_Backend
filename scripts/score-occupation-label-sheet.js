import { readFile } from "node:fs/promises";

function parseCsv(text) {
  const rows = []; let row = []; let value = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") { row.push(value); value = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(value); if (row.some((part) => part.trim())) rows.push(row); row = []; value = "";
    } else value += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted cell.");
  if (row.length || value) { row.push(value); rows.push(row); }
  const [header = [], ...records] = rows;
  const names = header.map((name) => name.trim().toLowerCase());
  return records.map((record) => Object.fromEntries(names.map((name, index) => [name, record[index] || ""])));
}

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/score-occupation-label-sheet.js <completed.csv>");
const rows = parseCsv(await readFile(file, "utf8"));
const predictedKey = "predicted family";
const goldKey = "correct family";
const completed = rows.filter((row) => row[goldKey]?.trim());
if (!completed.length) throw new Error("No corrected family labels found.");
const families = new Set(completed.flatMap((row) => [row[predictedKey] || "unclassified", row[goldKey]]));
const perFamily = Object.fromEntries([...families].sort().map((family) => {
  const tp = completed.filter((row) => (row[predictedKey] || "unclassified") === family && row[goldKey] === family).length;
  const fp = completed.filter((row) => (row[predictedKey] || "unclassified") === family && row[goldKey] !== family).length;
  const fn = completed.filter((row) => (row[predictedKey] || "unclassified") !== family && row[goldKey] === family).length;
  return [family, { support: tp + fn, predicted: tp + fp, precision: tp + fp ? Number((tp / (tp + fp)).toFixed(4)) : null, recall: tp + fn ? Number((tp / (tp + fn)).toFixed(4)) : null }];
}));
const correct = completed.filter((row) => row[predictedKey] === row[goldKey]).length;
console.log(JSON.stringify({ sampleRows: rows.length, labeledRows: completed.length, accuracy: Number((correct / completed.length).toFixed(4)), unclassifiedShare: Number((completed.filter((row) => (row[predictedKey] || "unclassified") === "unclassified").length / completed.length).toFixed(4)), perFamily }, null, 2));
