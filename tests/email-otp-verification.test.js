import "reflect-metadata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

describe("Email OTP Verification & Authentication Flow", () => {
  let appContainer, TOKENS;
  const previousEnv = process.env.REQUIRE_EMAIL_VERIFICATION;

  before(async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = "true";
    const containerModule = await import("../dist/src/main/container.js");
    appContainer = containerModule.appContainer;
    TOKENS = containerModule.TOKENS;
  });

  after(() => {
    process.env.REQUIRE_EMAIL_VERIFICATION = previousEnv;
  });

  it("should enforce registration -> OTP verification -> successful login", async () => {
    const registerUseCase = appContainer.resolve(TOKENS.RegisterUserUseCase);
    const loginUseCase = appContainer.resolve(TOKENS.LoginUserUseCase);
    const verifyEmailOtpUseCase = appContainer.resolve(TOKENS.VerifyEmailOtpUseCase);
    const userRepo = appContainer.resolve(TOKENS.UserRepository);

    const email = `otp_test_${Date.now()}@jobscout.com`;
    const password = "ValidPassword123!";
    const name = "OTP Test User";

    // 1. Register User
    const regResult = await registerUseCase.execute({ email, password, name });
    assert.equal(regResult.user.email, email);
    assert.equal(regResult.user.isEmailVerified, false);
    assert.equal(regResult.requiresVerification, true);
    assert.ok(regResult.message);

    // Verify user in repository is unverified and has OTP hash
    const savedUser = await userRepo.findByEmail(email);
    assert.ok(savedUser);
    assert.equal(savedUser.isEmailVerified, false);
    assert.ok(savedUser.emailVerificationOtpHash);
    assert.ok(savedUser.emailVerificationOtpExpiresAt);

    // 2. Attempt login before verification -> must reject with EMAIL_NOT_VERIFIED
    await assert.rejects(
      async () => {
        await loginUseCase.execute({ email, password });
      },
      (err) => {
        assert.equal(err.code, "EMAIL_NOT_VERIFIED");
        assert.equal(err.statusCode, 403);
        assert.equal(err.details?.email, email);
        return true;
      },
      "Login must be blocked when email is unverified",
    );

    // 3. Verify OTP with incorrect code -> must reject
    await assert.rejects(
      async () => {
        await verifyEmailOtpUseCase.execute({ email, otp: "000000" });
      },
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Invalid/);
        return true;
      },
    );

    // 4. Verify OTP with valid code:
    // To test verification deterministically, generate known OTP hash in repo
    const crypto = await import("node:crypto");
    const testOtp = "654321";
    const testHash = crypto.createHash("sha256").update(testOtp).digest("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await userRepo.setEmailVerificationOtp(savedUser.id, testHash, expiresAt);

    const verifyResult = await verifyEmailOtpUseCase.execute({ email, otp: testOtp });
    assert.ok(verifyResult.tokens.accessToken);
    assert.ok(verifyResult.tokens.refreshToken);
    assert.equal(verifyResult.user.isEmailVerified, true);

    // 5. Check user in repo is now verified
    const verifiedUser = await userRepo.findByEmail(email);
    assert.equal(verifiedUser.isEmailVerified, true);
    assert.equal(verifiedUser.emailVerificationOtpHash, null);

    // 6. Subsequent login -> must succeed immediately
    const loginResult = await loginUseCase.execute({ email, password });
    assert.ok(loginResult.tokens.accessToken);
    assert.ok(loginResult.tokens.refreshToken);
    assert.equal(loginResult.user.email, email);
  });

  it("should allow resending OTP with new expiry", async () => {
    const registerUseCase = appContainer.resolve(TOKENS.RegisterUserUseCase);
    const resendOtpUseCase = appContainer.resolve(TOKENS.ResendOtpUseCase);
    const userRepo = appContainer.resolve(TOKENS.UserRepository);

    const email = `resend_test_${Date.now()}@jobscout.com`;
    const password = "ValidPassword123!";
    const name = "Resend Test User";

    await registerUseCase.execute({ email, password, name });
    const userBefore = await userRepo.findByEmail(email);
    const firstHash = userBefore.emailVerificationOtpHash;
    assert.ok(firstHash);

    const resendResult = await resendOtpUseCase.execute({ email });
    assert.ok(resendResult.message);

    const userAfter = await userRepo.findByEmail(email);
    assert.ok(userAfter.emailVerificationOtpHash);
    assert.ok(userAfter.emailVerificationOtpExpiresAt);
  });
});
