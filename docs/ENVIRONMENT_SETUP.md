# Environment and API key setup

The backend owns all private credentials. Never put model, storage, payment, email, or job-source API keys in the frontend or in a `NEXT_PUBLIC_*` variable. `AiJob_search_backend/.env.example` is the backend template; `Ai_resume_frontend/.env.example` is the browser-safe template. Use each service's secret manager in staging and production, and do not commit `.env` files.

## Minimum setup for local resume extraction

1. Add a Gemini key from [Google AI Studio](https://aistudio.google.com/apikey) to `AiJob_search_backend/.env`:

   ```dotenv
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=your-key
   GEMINI_MODEL_SMALL=gemini-3.5-flash-lite
   GEMINI_MODEL_STRONG=gemini-3.5-flash-lite
   GEMINI_DATA_POLICY_CLASS=unpaid_free_tier
   AI_ALLOW_MOCKS=true
   ```

   Or configure Groq instead / additionally:

   ```dotenv
   LLM_PROVIDER=groq
   GROQ_API_KEY=your-server-side-key
   GROQ_MODEL_SMALL=openai/gpt-oss-20b
   GROQ_MODEL_STRONG=openai/gpt-oss-120b
   ```

2. Set backend secrets. `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must each be at least 32 characters. `RESUME_ENCRYPTION_KEY` must be at least 32 characters; a 64-character hex value is recommended.

3. Run MongoDB and Redis locally, or configure `MONGODB_URI` and `REDIS_URL` for hosted services.

4. Set the frontend's public API URL in `Ai_resume_frontend/.env.local`:

   ```dotenv
   NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

The frontend does **not** need any model provider key. Model calls are made by the backend, so provider keys never reach the browser. `AI_ALLOW_MOCKS=true` permits synthetic responses only in local development and tests; set it to `false` in production. In production, resume, profile, and interview-answer operations reject providers classified as `unpaid_free_tier`. Set a provider's data-policy class to `paid_api` only after verifying the actual provider account and applicable terms.

## Frontend variables

| Variable                       | Required                      | Purpose                                                                                                                                          |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_API_BASE_URL`     | Yes outside local development | Public URL of the backend API.                                                                                                                   |
| `NEXT_PUBLIC_SITE_URL`         | Recommended                   | Canonical site URL for metadata and auth redirects.                                                                                              |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Only for Google sign-in       | Public OAuth web client ID. Configure the authorized origins and redirect URIs in Google Cloud. This is an identifier, not a private API secret. |
| `NEXT_PUBLIC_SENTRY_DSN`       | Optional                      | Browser error reporting. DSNs are designed to be public; configure server-side `SENTRY_DSN` separately if needed.                                |

## Backend credentials by feature

| Variable(s)                                                                                                             | Required for                                        | Notes                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`                                                                               | Authentication                                      | Each must be at least 32 characters; generate random independent values.                                                                                                                                                                          |
| `SUPER_ADMIN_EMAIL`                                                                                                     | First super administrator bootstrap                 | Existing account email promoted by the API at startup. Clear after provisioning; future roles are managed in the protected super-admin console.                                                                                                   |
| `RESUME_ENCRYPTION_KEY`                                                                                                 | Resume text encryption                              | At least 32 characters. Keep backups secure; losing it prevents decryption of saved resume text.                                                                                                                                                  |
| `GEMINI_API_KEY`, `GEMINI_MODEL_SMALL`, `GEMINI_MODEL_STRONG`, `GEMINI_DATA_POLICY_CLASS`                               | AI when `LLM_PROVIDER=gemini`                       | Backend only. Exact model IDs must be active and priced in `src/ai/modelPricingCatalog.js`. Production personal-data features require a verified `paid_api` classification.                                                                          |
| `GROQ_API_KEY`, `GROQ_MODEL_SMALL`, `GROQ_MODEL_STRONG`, `GROQ_DATA_POLICY_CLASS`                                       | AI when `LLM_PROVIDER=groq`                         | Backend only. Exact model IDs must be active and priced in the catalog. Production personal-data features require a verified `paid_api` classification.                                                                                            |
| `ANTHROPIC_API_KEY`, `MODEL_SMALL`, `MODEL_STRONG`                                                                      | Anthropic LLM provider                              | Currently disabled: the previous Claude 3.5 IDs are retired and no active Anthropic models are cataloged. Startup rejects this provider until active IDs and prices are added.                                                                       |
| `MONGODB_URI`                                                                                                           | Persistent accounts, profiles, jobs, and audit data | Defaults to local MongoDB for development. Use a secured hosted URI in production.                                                                                                                                                                |
| `REDIS_URL`                                                                                                             | Shared cache, quotas, and queues                    | Defaults to local Redis. Use a secured hosted instance in production.                                                                                                                                                                             |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                                     | Durable original resume and export file storage     | Use AWS S3 or an S3-compatible service such as Cloudflare R2. In local development, dummy credentials enable mock mode only; they do not save a file.                                                                                             |
| `EMBEDDING_PROVIDER` and the selected provider's key/model/dimension (`OPENAI_*` or `VOYAGE_*`)                         | Embeddings                                          | Choose one provider and provide its credential. These keys are separate from the chat/extraction LLM key. Production never falls back to mock vectors.                                                                                             |
| `AI_ALLOW_MOCKS`                                                                                                        | Local development/tests only                        | Set `true` to opt into deterministic mocks and in-memory quota storage locally. Production rejects mock mode; set `false`.                                                                                                                       |
| `REDIS_URL`, `MONGODB_URI`                                                                                               | Production AI quota and usage ledger                | Durable controls require both. Production AI calls fail closed with retryable 503 responses if the quota or ledger store is unavailable.                                                                                                         |
| `AI_BLOCK_UNPAID_PERSONAL_DATA`, `GEMINI_DATA_POLICY_CLASS`, `GROQ_DATA_POLICY_CLASS`                                    | Personal-data policy                                | Keep blocking enabled. Resume, profile, and interview-answer content requires the selected provider's verified `paid_api` classification in production.                                                                                            |
| `AI_MONTHLY_ALLOWANCE_SHADOW_MODE`, `AI_MONTHLY_ALLOWANCE_SHADOW_RATIO`, `AI_PROVIDER_MAX_RETRIES`                       | Cost controls                                       | Monthly allowance and per-request reservation signals are log-only; monthly enforcement and atomic reservations are not enabled. Retries are limited to 0–3, default 1; timeout errors are never retried.                                        |
| `GOOGLE_CLIENT_ID`                                                                                                      | Backend Google token verification                   | Needed with the frontend OAuth client ID if Google sign-in is enabled.                                                                                                                                                                            |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_API_KEY`                                                                     | Optional job-source integrations                    | Only required for the corresponding configured adapters.                                                                                                                                                                                          |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_ID_PRO`, `RAZORPAY_PLAN_ID_PREMIUM` | Razorpay subscriptions                              | Configure a plan ID for each paid tier in Razorpay; dummy values disable checkout.                                                                                                                                                                |
| `RESEND_API_KEY`, `FROM_EMAIL`                                                                                          | Transactional email and due follow-up reminders     | Required for actual delivery; local dummy settings log reminders without sending mail.                                                                                                                                                            |
| `SENTRY_DSN`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`                                                              | Optional error reporting and LLM tracing            | Do not send resume text to an observability provider unless its privacy settings and retention are appropriate.                                                                                                                                   |

## Provider switching

Provider choice and model IDs are backend configuration only. Set `LLM_PROVIDER=gemini`, `groq`, or `anthropic` and provide the matching server-side API key. To add a future provider, implement the provider contract under `src/ai/providers/`, register it, and use the shared `invokeLLM` boundary. See [LLM_PROVIDERS.md](./LLM_PROVIDERS.md).
