# Casing Strategy & Code Style Guidelines

JobScout API enforces deterministic naming conventions across JavaScript code, filenames, database schemas, Redis keys, and HTTP REST APIs.

---

## 1. Summary Matrix

| Artifact                    | Convention            | Example                                                 |
| :-------------------------- | :-------------------- | :------------------------------------------------------ |
| **Variables & Functions**   | `camelCase`           | `accessToken`, `computeMatchScore()`, `checkQuota()`    |
| **Classes & Models**        | `PascalCase`          | `User`, `UsageEvent`, `AuditLog`, `OAuth2Client`        |
| **Constants & Enums**       | `UPPER_SNAKE_CASE`    | `CACHE_NAMESPACE`, `PLANS.FREE`, `MAX_TOKENS`           |
| **Environment Variables**   | `UPPER_SNAKE_CASE`    | `MONGODB_URI`, `JWT_ACCESS_SECRET`, `MODEL_STRONG`      |
| **Model Filenames**         | `PascalCase.js`       | `User.js`, `UsageEvent.js`, `AuditLog.js`               |
| **Service/Route Filenames** | `camelCase.js`        | `authService.js`, `authController.js`, `rateLimiter.js` |
| **CLI & Script Filenames**  | `kebab-case.js`       | `ensure-indexes.js`, `smoke.js`, `openapi.js`           |
| **MongoDB Fields**          | `camelCase`           | `passwordHash`, `failedLoginAttempts`, `lockUntil`      |
| **Redis Key Namespaces**    | `kebab-case` + colons | `js:v1:resp:{userId}:{resource}:v{ver}`                 |
| **API JSON Keys**           | `camelCase`           | `{ "accessToken": "...", "expiresAt": 1718293 }`        |
| **API Error Codes**         | `UPPER_SNAKE_CASE`    | `"ACCOUNT_LOCKED"`, `"QUOTA_EXCEEDED"`                  |

---

## 2. JavaScript & JSDoc Standards

- **Language**: Pure JavaScript (ES Modules, Node.js 22 LTS). **No TypeScript** compilation step.
- **Type Checking via JSDoc**: Functions and public service interfaces must be annotated with standard JSDoc tags:
  ```javascript
  /**
   * Verifies candidate quota and records usage.
   * @param {Object} user - User document
   * @param {string} user.id - User unique identifier
   * @param {string} feature - Feature name
   * @returns {Promise<boolean>} Resolves true if quota is valid
   * @throws {Error} Throws 429 when quota exceeded
   */
  export async function checkQuota(user, feature) { ... }
  ```
- **Runtime Schema Validation**: All external inputs (request bodies, query params, LLM outputs, uploaded file headers) are validated using **Zod** schemas.

---

## 3. Filename Conventions

1. **Services, Controllers, Middleware, Repositories, Helpers**:
   - `src/controllers/authController.js`
   - `src/services/quotaService.js`
   - `src/repositories/userRepository.js`
   - `src/middleware/errorHandler.js`
   - `src/shared/cache.js`
2. **Mongoose Models**:
   - `src/models/User.js`
   - `src/models/UsageEvent.js`
   - `src/models/AuditLog.js`
3. **Scripts & Utilities**:
   - `scripts/smoke.js`
   - `scripts/ensure-indexes.js`
   - `scripts/openapi.js`

---

## 4. API Contract & Response Formatting

All endpoints return a predictable JSON payload:

### Success Response

```json
{
  "data": {
    "user": {
      "id": "6724a8...",
      "email": "candidate@example.com",
      "plan": "pro"
    },
    "accessToken": "eyJhbGciOi..."
  }
}
```

### Error Response

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Daily chat quota reached (20/20 messages). Upgrade to Pro for higher limits.",
    "requestId": "req_8v3Kz91La"
  }
}
```

Stack traces are **never** returned in HTTP responses; unhandled exceptions are logged with Sentry and Pino redactions.
