import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = path.join(root, "docs/ai/01-ai-inventory.md");
const promptPath = path.join(root, "docs/ai/04-prompt-registry.md");
const envDocsPath = path.join(root, "docs/operations/environment-variables.md");
const inventory = fs.readFileSync(inventoryPath, "utf8");
const prompts = fs.readFileSync(promptPath, "utf8");
const envDocs = fs.readFileSync(envDocsPath, "utf8");
const errors = [];

function walk(directory, extension, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, extension, output);
    else if (entry.isFile() && fullPath.endsWith(extension)) output.push(fullPath);
  }
  return output;
}

const sourceFiles = walk(path.join(root, "src"), ".js");
const callsitePatterns = [
  /\b(?:invokeLLM|streamLLM)\s*\(/,
  /\.(?:embedDocuments|embedQuery|getEmbeddingsWithMetadata|getEmbeddingWithMetadata)\s*\(/,
];
for (const file of sourceFiles) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  if (
    lines.some((line) => callsitePatterns.some((pattern) => pattern.test(line))) &&
    !inventory.includes(relative)
  ) {
    errors.push("AI callsite missing from docs/ai/01-ai-inventory.md: " + relative);
  }
}

const code = sourceFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
const promptIds = new Set(code.match(/\b[A-Z][A-Z0-9_]*_PROMPT_VERSION\b/g) || []);
for (const id of promptIds) {
  if (!prompts.includes(id) && !inventory.includes(id)) {
    errors.push("Prompt version in code missing from docs/ai/04-prompt-registry.md: " + id);
  }
}

const envNames = new Set(
  [...code.matchAll(/(?:process\.env|env)\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]),
);
for (const name of envNames) {
  if (!envDocs.includes(name))
    errors.push(
      "Environment variable missing from docs/operations/environment-variables.md: " + name,
    );
}

const markdownFiles = [
  ...walk(path.join(root, "docs"), ".md"),
  path.join(root, "README.md"),
  path.join(root, "AGENTS.md"),
  path.join(root, ".github/pull_request_template.md"),
];
for (const file of markdownFiles) {
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  if (
    file.startsWith(path.join(root, "docs/ai")) &&
    (!source.includes("Last verified against commit") ||
      !source.includes("As built (verified in code)") ||
      !source.includes("Target design (not built yet)"))
  ) {
    errors.push(
      "AI documentation is missing verification/build sections: " + path.relative(root, file),
    );
  }
  for (const [, href] of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|mailto:|#)/i.test(href)) continue;
    const target = decodeURIComponent(href.split("#")[0]);
    if (!target) continue;
    const resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved))
      errors.push("Broken internal link in " + path.relative(root, file) + ": " + href);
  }
}

if (errors.length) {
  for (const error of errors) console.error("AI docs check: " + error);
  process.exitCode = 1;
} else {
  console.log(
    "AI docs check passed (" +
      sourceFiles.length +
      " JS files, " +
      envNames.size +
      " environment names, " +
      markdownFiles.length +
      " markdown pages).",
  );
}
