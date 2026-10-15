// Test doubles and in-memory stores are opt-in for every test process.
process.env.NODE_ENV ||= "test";
process.env.AI_ALLOW_MOCKS ||= "true";
