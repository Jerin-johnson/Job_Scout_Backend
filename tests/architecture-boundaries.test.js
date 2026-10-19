import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

test("Architecture Boundaries: production source code strictly passes all boundary checks", () => {
  const output = execFileSync("node", ["scripts/check-architecture.mjs"], {
    encoding: "utf8",
  });

  assert.ok(
    output.includes("Architecture Boundary Check PASSED"),
    "Output must indicate passed checks",
  );
  assert.ok(
    output.includes("0 infrastructure/framework imports"),
    "Domain must have 0 infrastructure imports",
  );
  assert.ok(
    output.includes("0 infrastructure adapter couplings"),
    "Application must have 0 adapter couplings",
  );
  assert.ok(
    output.includes("0 controller couplings"),
    "Infrastructure must have 0 controller couplings",
  );
  assert.ok(
    output.includes("0 'any' type annotations"),
    "Source must have 0 'any' type annotations",
  );
});

test("Architecture Boundaries: rejects domain layer importing mongoose", () => {
  const tempFile = path.join("src", "domain", "entities", "TempViolationEntity.ts");
  try {
    fs.writeFileSync(
      tempFile,
      'import mongoose from "mongoose";\nexport class TempViolation {}\n',
      "utf8",
    );

    assert.throws(
      () => {
        execFileSync("node", ["scripts/check-architecture.mjs"], {
          encoding: "utf8",
          stdio: "pipe",
        });
      },
      /Domain must not depend on external infrastructure packages/,
      "Checker must throw error for domain importing mongoose",
    );
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});

test("Architecture Boundaries: rejects domain layer importing outer infrastructure layers", () => {
  const tempFile = path.join("src", "domain", "entities", "TempLayerViolationEntity.ts");
  try {
    fs.writeFileSync(
      tempFile,
      'import { S3StorageService } from "../../infrastructure/storage/S3StorageService.js";\nexport class TempLayerViolation {}\n',
      "utf8",
    );

    assert.throws(
      () => {
        execFileSync("node", ["scripts/check-architecture.mjs"], {
          encoding: "utf8",
          stdio: "pipe",
        });
      },
      /Domain must not depend on outer layers/,
      "Checker must throw error for domain importing infrastructure",
    );
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});

test("Architecture Boundaries: rejects explicit any type annotations in source files", () => {
  const tempFile = path.join("src", "domain", "entities", "TempAnyViolationEntity.ts");
  try {
    fs.writeFileSync(
      tempFile,
      "export function badFunc(data: any): void { console.info(data); }\n",
      "utf8",
    );

    assert.throws(
      () => {
        execFileSync("node", ["scripts/check-architecture.mjs"], {
          encoding: "utf8",
          stdio: "pipe",
        });
      },
      /Zero 'any' type annotations in TypeScript source files/,
      "Checker must throw error for explicit any annotations",
    );
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});

test("Architecture Boundaries: rejects application use case importing concrete infrastructure adapter", () => {
  const tempFile = path.join("src", "application", "useCases", "TempAdapterViolationUseCase.ts");
  try {
    fs.writeFileSync(
      tempFile,
      'import { MongooseUserRepository } from "../../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";\nexport class TempAdapterViolation {}\n',
      "utf8",
    );

    assert.throws(
      () => {
        execFileSync("node", ["scripts/check-architecture.mjs"], {
          encoding: "utf8",
          stdio: "pipe",
        });
      },
      /Application use cases must depend on domain interfaces/,
      "Checker must throw error for use case importing concrete adapter",
    );
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});
