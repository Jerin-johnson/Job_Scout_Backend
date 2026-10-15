# Environment and API key setup

The backend owns all private credentials. Never put model, storage, payment, email, or job-source API keys in the frontend or in a `NEXT_PUBLIC_*` variable. `AiJob_search_backend/.env.example` is the backend template; `Ai_resume_frontend/.env.example` is the browser-safe template. Use each service's secret manager in staging and production, and do not commit `.env` files.

## Minimum setup for local resume extraction

1. Add a Gemini key from [Google AI Studio](https://aistudio.google.com/apikey) to `AiJob_search_backend/.env`:

   ```dotenv
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=your-key
   GEMINI_MODEL_SMALL=gemini-3.5-flash-lite
   GEMINI_MODEL_STRONG=gemini-3.5-flash-lite
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

The frontend does **not** need any model provider key. Model calls are made by the backend, so provider keys never reach the browser. Resume uploads fail with `AI_PROVIDER_NOT_CONFIGURED` until the selected backend provider has a real key; the API no longer fills a profile with demo facts.

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
| `GEMINI_API_KEY`                                                                                                        | AI and resume extraction when `LLM_PROVIDER=gemini` | Backend only. The Gemini implementation uses LangChain. Gemini 3.5 Flash-Lite is the low-cost default for both tiers. The server allowlists free-tier chat model IDs and rejects paid/unknown Gemini IDs. Free-tier data-use terms differ from paid-tier terms; see [LLM provider and privacy guidance](./LLM_PROVIDERS.md). |
| `GROQ_API_KEY`                                                                                                          | AI and resume extraction when `LLM_PROVIDER=groq`   | Backend only. Uses the existing LangChain OpenAI-compatible adapter. Defaults: `GROQ_MODEL_SMALL=openai/gpt-oss-20b`, `GROQ_MODEL_STRONG=openai/gpt-oss-120b`. Provider free-tier limits apply; Developer-tier usage can incur charges. See [LLM provider guidance](./LLM_PROVIDERS.md). |
| `ANTHROPIC_API_KEY`                                                                                                     | AI when `LLM_PROVIDER=anthropic`                    | Use this instead of the Gemini key when selecting Anthropic. Configure `MODEL_SMALL` and `MODEL_STRONG` with supported model IDs.                                                                                                                 |
| `MONGODB_URI`                                                                                                           | Persistent accounts, profiles, jobs, and audit data | Defaults to local MongoDB for development. Use a secured hosted URI in production.                                                                                                                                                                |
| `REDIS_URL`                                                                                                             | Shared cache, quotas, and queues                    | Defaults to local Redis. Use a secured hosted instance in production.                                                                                                                                                                             |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                                     | Durable original resume and export file storage     | Use AWS S3 or an S3-compatible service such as Cloudflare R2. In local development, dummy credentials enable mock mode only; they do not save a file.                                                                                             |
| `OPENAI_API_KEY` or `VOYAGE_API_KEY`                                                                                    | Job-search embeddings                               | `EMBEDDING_PROVIDER=openai` uses OpenAI; set `EMBEDDING_PROVIDER=voyage` to use Voyage. These are separate from the selected chat/extraction LLM provider.                                                                                        |
| `GOOGLE_CLIENT_ID`                                                                                                      | Backend Google token verification                   | Needed with the frontend OAuth client ID if Google sign-in is enabled.                                                                                                                                                                            |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_API_KEY`                                                                     | Optional job-source integrations                    | Only required for the corresponding configured adapters.                                                                                                                                                                                          |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_ID_PRO`, `RAZORPAY_PLAN_ID_PREMIUM` | Razorpay subscriptions                              | Configure a plan ID for each paid tier in Razorpay; dummy values disable checkout.                                                                                                                                                                |
| `RESEND_API_KEY`, `FROM_EMAIL`                                                                                          | Transactional email and due follow-up reminders     | Required for actual delivery; local dummy settings log reminders without sending mail.                                                                                                                                                            |
| `SENTRY_DSN`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`                                                              | Optional error reporting and LLM tracing            | Do not send resume text to an observability provider unless its privacy settings and retention are appropriate.                                                                                                                                   |

## Provider switching

Provider choice and model IDs are backend configuration only. Set `LLM_PROVIDER=gemini`, `groq`, or `anthropic` and provide the matching server-side API key. To add a future provider, implement the provider contract under `src/ai/providers/`, register it, and use the shared `invokeLLM` boundary. See [LLM_PROVIDERS.md](./LLM_PROVIDERS.md).
