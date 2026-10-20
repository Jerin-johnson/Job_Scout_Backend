import test from "node:test";
import assert from "node:assert/strict";
import { checkRedisMaxmemoryPolicy } from "../src/infrastructure/cache/redis.js";

test("Redis policy check accepts noeviction and reports other policies without changing them", async () => {
  let calls = 0;
  const valid = await checkRedisMaxmemoryPolicy({
    async config(...args) {
      calls += 1;
      assert.deepEqual(args, ["GET", "maxmemory-policy"]);
      return ["maxmemory-policy", "noeviction"];
    },
  });
  const invalid = await checkRedisMaxmemoryPolicy({
    async config() {
      return ["maxmemory-policy", "volatile-lru"];
    },
  });
  assert.deepEqual(valid, { valid: true, policy: "noeviction" });
  assert.deepEqual(invalid, { valid: false, policy: "volatile-lru" });
  assert.equal(calls, 1);
});
