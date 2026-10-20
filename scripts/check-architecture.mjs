import fs from "node:fs";
import path from "node:path";

function getAllTsFiles(dir) {
  let res = [];
  if (!fs.existsSync(dir)) return res;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (f !== "node_modules" && f !== ".git" && f !== "dist") {
        res = res.concat(getAllTsFiles(p));
      }
    } else if (f.endsWith(".ts") && !f.endsWith(".d.ts")) {
      res.push(path.normalize(p));
    }
  }
  return res;
}

function getAllJsFilesInSrc() {
  const res = [];
  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) {
        scan(p);
      } else if (f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".cjs")) {
        res.push(path.normalize(p));
      }
    }
  }
  scan("src");
  return res;
}

const violations = [];

// 0. Ensure obsolete competing directories are NOT reintroduced
const obsoleteDirs = [
  { path: "src/routes", canonical: "src/presentation/http/routes/" },
  { path: "src/controllers", canonical: "src/presentation/http/controllers/" },
  { path: "src/middleware", canonical: "src/presentation/http/middleware/" },
  { path: "src/models", canonical: "src/infrastructure/database/mongoose/models/" },
  { path: "src/repositories", canonical: "src/infrastructure/database/mongoose/repositories/" },
  { path: "src/services", canonical: "src/domain/services/ and src/infrastructure/" },
  { path: "src/ai", canonical: "src/infrastructure/ai/" },
  {
    path: "src/infrastructure/database/mongoose/services",
    canonical: "src/domain/services/, src/infrastructure/, and src/application/useCases/",
  },
];

for (const obsolete of obsoleteDirs) {
  if (fs.existsSync(obsolete.path)) {
    const remainingFiles = fs.readdirSync(obsolete.path);
    if (remainingFiles.length > 0) {
      violations.push({
        rule: "Obsolete architectural directory reintroduction forbidden",
        file: obsolete.path,
        detail: `The '${obsolete.path}/' directory was canonically consolidated into '${obsolete.canonical}' and must not be reintroduced (found: ${remainingFiles.join(", ")})`,
      });
    }
  }
}

// 0.1 Ensure zero .js files in src/
const jsFilesInSrc = getAllJsFilesInSrc();
if (jsFilesInSrc.length > 0) {
  violations.push({
    rule: "Zero JavaScript files allowed in src/",
    file: "src/",
    detail: `Found ${jsFilesInSrc.length} JavaScript file(s) in src/: ${jsFilesInSrc.join(", ")}`,
  });
}

// 1. Check Domain Layer boundaries
const domainFiles = getAllTsFiles("src/domain");
const forbiddenDomainPackages = [
  "mongoose",
  "express",
  "ioredis",
  "bullmq",
  "@aws-sdk",
  "@langchain",
  "@google",
  "@anthropic",
  "openai",
  "groq-sdk",
  "dotenv",
];

for (const file of domainFiles) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    // Check forbidden external packages
    for (const pkg of forbiddenDomainPackages) {
      const pkgRegex = new RegExp(`from\\s+['"]${pkg}(?:/[^'"]*)?['"]`);
      if (pkgRegex.test(line)) {
        violations.push({
          rule: "Domain must not depend on external infrastructure packages (Mongoose, Express, Redis, BullMQ, SDKs)",
          file,
          line: idx + 1,
          detail: `Import of '${pkg}' in domain layer: "${line.trim()}"`,
        });
      }
    }

    // Check layer inversion (domain importing infrastructure or presentation)
    if (/from\s+['"].*?\/(?:infrastructure|presentation|controllers|routes)\//.test(line)) {
      violations.push({
        rule: "Domain must not depend on outer layers (infrastructure, presentation, controllers, routes)",
        file,
        line: idx + 1,
        detail: `Outer layer import in domain: "${line.trim()}"`,
      });
    }
  });
}

// 2. Check Application Layer Use Cases boundaries
const useCaseFiles = getAllTsFiles("src/application/useCases");
for (const file of useCaseFiles) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    // Application use cases must not directly import concrete infrastructure adapters or repositories
    const isConcreteRepoOrAdapter =
      /from\s+['"].*?(?:infrastructure\/(?:database\/mongoose\/repositories|security|storage|email))/.test(
        line,
      ) ||
      (/from\s+['"].*?repositories\/[A-Za-z]/.test(line) && !line.includes("domain/repositories"));

    if (isConcreteRepoOrAdapter) {
      violations.push({
        rule: "Application use cases must depend on domain interfaces, not concrete infrastructure repositories or adapters",
        file,
        line: idx + 1,
        detail: `Direct infrastructure repository/adapter import in use case: "${line.trim()}"`,
      });
    }
    // Application use cases must not import Mongoose or Mongoose models directly
    if (/from\s+['"](?:mongoose|.*?\/mongoose\/models\/.*?)['"]/.test(line)) {
      violations.push({
        rule: "Application use cases must not depend directly on Mongoose persistence models",
        file,
        line: idx + 1,
        detail: `Mongoose import in use case: "${line.trim()}"`,
      });
    }
    // Application use cases must not import express Request/Response
    if (/from\s+['"]express['"]/.test(line)) {
      violations.push({
        rule: "Application use cases must not depend on HTTP frameworks (Express)",
        file,
        line: idx + 1,
        detail: `Express import in use case: "${line.trim()}"`,
      });
    }
  });
}

// 3. Check Infrastructure Layer boundaries
const infraFiles = getAllTsFiles("src/infrastructure");
for (const file of infraFiles) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    // Infrastructure must not import HTTP presentation controllers
    if (/from\s+['"].*?\/(?:presentation\/http\/controllers|controllers)\//.test(line)) {
      violations.push({
        rule: "Infrastructure must not depend on presentation controllers",
        file,
        line: idx + 1,
        detail: `Controller import in infrastructure: "${line.trim()}"`,
      });
    }
  });
}

// 4. Strict Type Safety: Zero 'any' type annotation across all src/ files
const allSrcFiles = getAllTsFiles("src");
for (const file of allSrcFiles) {
  const content = fs.readFileSync(file, "utf8");
  const anyTypeMatches = content.match(/:\s*any\b|<any\b|\bas\s+any\b|any\[\]/g);
  if (anyTypeMatches) {
    violations.push({
      rule: "Zero 'any' type annotations in TypeScript source files",
      file,
      detail: `Found ${anyTypeMatches.length} 'any' type annotation(s): ${anyTypeMatches.join(", ")}`,
    });
  }
}

if (violations.length > 0) {
  console.error(`Architecture Boundary Check FAILED with ${violations.length} violation(s):\n`);
  violations.forEach((v, i) => {
    console.error(`[${i + 1}] ${v.rule}`);
    console.error(`    File: ${v.file}${v.line ? `:${v.line}` : ""}`);
    console.error(`    Detail: ${v.detail}\n`);
  });
  process.exit(1);
}

console.log(`Architecture Boundary Check PASSED:`);
console.log(
  `- Obsolete directories: all 7 legacy directories (routes, controllers, middleware, models, repositories, services, ai) removed`,
);
console.log(`- JavaScript files in src/: 0 files found`);
console.log(
  `- Domain layer: 0 infrastructure/framework imports across ${domainFiles.length} files`,
);
console.log(
  `- Application layer: 0 infrastructure adapter couplings across ${useCaseFiles.length} use cases`,
);
console.log(`- Infrastructure layer: 0 controller couplings across ${infraFiles.length} files`);
console.log(
  `- Type safety: 0 'any' type annotations across all ${allSrcFiles.length} source files`,
);
