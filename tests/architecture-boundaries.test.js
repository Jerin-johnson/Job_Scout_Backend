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
  assert.ok(
    output.includes("'src/routes' is completely removed"),
    "src/routes must be confirmed eliminated",
  );
});

test("Architecture Boundaries: rejects domain layer importing mongoose", () => {
  const tempFile = path.join("src", "domain", "entities", "TempViolationMongoose.ts");
  try {
    fs.writeFileSync(
      tempFile,
      'import mongoose from "mongoose";\nexport class TempViolationMongoose {}\n',
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

test("Architecture Boundaries: rejects domain layer importing express", () => {
  const tempFile = path.join("src", "domain", "entities", "TempViolationExpress.ts");
  try {
    fs.writeFileSync(
      tempFile,
      'import { Request } from "express";\nexport class TempViolationExpress {}\n',
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
      "Checker must throw error for domain importing express",
    );
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});

test("Architecture Boundaries: rejects domain layer importing ai provider sdk", () => {
  const tempFile = path.join("src", "domain", "entities", "TempViolationAi.ts");
  try {
    fs.writeFileSync(
      tempFile,
      'import { ChatOpenAI } from "@langchain/openai";\nexport class TempViolationAi {}\n',
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
      "Checker must throw error for domain importing ai sdk",
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

test("Architecture Boundaries: rejects application use case importing concrete infrastructure repository", () => {
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
      "Checker must throw error for use case importing concrete repository",
    );
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});

test("Architecture Boundaries: rejects application use case importing mongoose directly", () => {
  const tempFile = path.join("src", "application", "useCases", "TempMongooseUseCase.ts");
  try {
    fs.writeFileSync(
      tempFile,
      'import mongoose from "mongoose";\nexport class TempMongooseUseCase {}\n',
      "utf8",
    );

    assert.throws(
      () => {
        execFileSync("node", ["scripts/check-architecture.mjs"], {
          encoding: "utf8",
          stdio: "pipe",
        });
      },
      /Application use cases must not depend directly on Mongoose persistence models/,
      "Checker must throw error for use case importing mongoose",
    );
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});

test("Architecture Boundaries: rejects application use case importing express", () => {
  const tempFile = path.join("src", "application", "useCases", "TempExpressUseCase.ts");
  try {
    fs.writeFileSync(
      tempFile,
      'import { Request, Response } from "express";\nexport class TempExpressUseCase {}\n',
      "utf8",
    );

    assert.throws(
      () => {
        execFileSync("node", ["scripts/check-architecture.mjs"], {
          encoding: "utf8",
          stdio: "pipe",
        });
      },
      /Application use cases must not depend on HTTP frameworks/,
      "Checker must throw error for use case importing express",
    );
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});

test("Architecture Boundaries: rejects infrastructure layer importing presentation controllers", () => {
  const tempFile = path.join(
    "src",
    "infrastructure",
    "security",
    "TempViolationControllerImport.ts",
  );
  try {
    fs.writeFileSync(
      tempFile,
      'import { AuthController } from "../../presentation/http/controllers/AuthController.js";\nexport class TempViolationControllerImport {}\n',
      "utf8",
    );

    assert.throws(
      () => {
        execFileSync("node", ["scripts/check-architecture.mjs"], {
          encoding: "utf8",
          stdio: "pipe",
        });
      },
      /Infrastructure must not depend on presentation controllers/,
      "Checker must throw error for infrastructure importing controller",
    );
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
});

test("Architecture Boundaries: rejects reintroduction of obsolete src/routes directory", () => {
  const tempRoutesDir = path.join("src", "routes");
  const tempRouteFile = path.join(tempRoutesDir, "tempRoute.ts");
  try {
    if (!fs.existsSync(tempRoutesDir)) {
      fs.mkdirSync(tempRoutesDir, { recursive: true });
    }
    fs.writeFileSync(tempRouteFile, "export const x = 1;\n", "utf8");

    assert.throws(
      () => {
        execFileSync("node", ["scripts/check-architecture.mjs"], {
          encoding: "utf8",
          stdio: "pipe",
        });
      },
      /Obsolete architectural directory reintroduction forbidden/,
      "Checker must throw error if src/routes is reintroduced",
    );
  } finally {
    if (fs.existsSync(tempRouteFile)) {
      fs.unlinkSync(tempRouteFile);
    }
    if (fs.existsSync(tempRoutesDir)) {
      fs.rmdirSync(tempRoutesDir);
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
