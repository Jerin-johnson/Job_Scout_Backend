import test from "node:test";
import assert from "node:assert/strict";
import { isTrustedWebOrigin } from "../src/shared/utils/webOrigin.js";

const developmentConfig = {
  NODE_ENV: "development",
  WEB_ORIGIN: "http://localhost:3000",
};

test("development trusts the configured origin and equivalent loopback hosts only", () => {
  assert.equal(isTrustedWebOrigin("http://localhost:3000", developmentConfig), true);
  assert.equal(isTrustedWebOrigin("http://127.0.0.1:3000", developmentConfig), true);
  assert.equal(isTrustedWebOrigin("http://[::1]:3000", developmentConfig), true);
  assert.equal(isTrustedWebOrigin("http://localhost:3001", developmentConfig), false);
  assert.equal(isTrustedWebOrigin("https://attacker.example", developmentConfig), false);
});

test("production allows only the configured frontend origin", () => {
  assert.equal(
    isTrustedWebOrigin("http://localhost:3000", { ...developmentConfig, NODE_ENV: "production" }),
    true,
  );
  assert.equal(
    isTrustedWebOrigin("http://127.0.0.1:3000", { ...developmentConfig, NODE_ENV: "production" }),
    false,
  );
});
