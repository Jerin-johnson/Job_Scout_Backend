import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const loader = new URL("./test-env.js", import.meta.url).href;

test("test bootstrap refuses hosted Mongo and Redis URLs without exposing values", () => {
  for (const [name, value] of [
    ["MONGODB_URI", "mongodb+srv://hosted.invalid/db"],
    ["REDIS_URL", "rediss://hosted.invalid:6379"],
  ]) {
    const child = spawnSync(process.execPath, ["--import", loader, "-e", "process.exit(0)"], {
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test", [name]: value },
    });
    assert.notEqual(child.status, 0, `${name} must be rejected`);
    assert.match(child.stderr, new RegExp(`${name} must point to loopback`));
    assert.doesNotMatch(child.stderr, /hosted\.invalid/);
  }
});

test("test bootstrap supplies loopback defaults before app config is loaded", () => {
  const child = spawnSync(process.execPath, ["--import", loader, "-e", "console.log(process.env.MONGODB_URI, process.env.REDIS_URL)"], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", MONGODB_URI: "", REDIS_URL: "" },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /mongodb:\/\/127\.0\.0\.1:27017\/jobscout_test redis:\/\/127\.0\.0\.1:6379/);
});
