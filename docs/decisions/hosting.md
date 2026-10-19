# Staging and beta hosting options

**Pricing checked:** 2026-10-18. Prices are USD, before taxes. These are planning estimates from official public pages, not provider quotes. No account was created and no service was provisioned.

## Current stack needs

JobScout is an Express API + BullMQ worker, Next.js frontend, MongoDB, Redis configured `noeviction`, private S3 resume storage with CORS, and a custom HTTPS domain. Keep the API, worker, MongoDB, Redis, and S3 in AWS Mumbai (`ap-south-1`) or Singapore when possible. The current S3 bucket is in Mumbai. Vercel's global edge can deliver static assets close to Kerala, but server rendering/API work may run elsewhere; the actual API round-trip must be measured from Kerala. Do not claim a latency SLA from geography alone.

## Options

### A. AWS Lightsail app host + existing managed services — lowest operational cost

- Run API and worker together initially on a 2 GB Lightsail Linux instance ($12/month), then split/resize as needed. Keep Redis local to that host only for a small beta; configure and verify `noeviction`, persistence, firewall, and backups. For stronger isolation, use AWS ElastiCache/Valkey; its official page states Serverless Valkey starts at $6/month, with cost depending on memory and request units.
- Keep MongoDB Atlas; Flex costs $8–$30/month (5 GB, max 500 ops/s tier), while dedicated clusters start at about $56.94/month on the public pricing page.
- Frontend on Vercel Pro ($20/month, $20 included usage credit) or serve a static frontend behind CloudFront if Next features allow it. TLS via Vercel or an AWS-managed certificate. Route 53 hosted zone is $0.50/month plus DNS queries. S3 remains private; configure the exact web origins in bucket CORS.

### B. Fly.io regional machines + managed Mongo/Redis — flexible, more per-service cost

- Run independent API and worker machines in a nearby supported region. A shared 1x/1 GB machine is listed at $5.92/month; a 1x/2 GB machine at $11.11/month. Add regional egress, persistent volumes, and a separate Redis service that supports required BullMQ semantics (`noeviction`, persistence, monitoring).
- Reuse Atlas and private S3. Frontend can remain on Vercel. This offers independent scaling and placement but adds cross-provider networking and egress, and nearby-machine availability should be verified before choosing.

### C. Render services + existing data services — easiest deploy flow, region check required

- Render lists the smallest always-on web/background plan at $7/service/month in its public compute/pricing material; API and worker are separate. Its current pricing page lists a $25 Pro workspace plan plus compute. Render Key Value and region availability/pricing must be checked against the required `noeviction` policy and queue durability before adoption; do not assume it is a fit from the label “Redis.”
- Use Atlas for Mongo and AWS S3 for resumes; Vercel or Render static hosting for the frontend. Verify Render's nearest available region from Kerala and measure p95. This is the simplest CI-driven path but may have workspace and cross-cloud costs.

## Indicative monthly infrastructure budget

Estimates assume continuous API/worker availability; 100/1,000 users fit the small baseline, while 10,000 users use separated app processes and larger database/cache capacity. They exclude AI/provider calls, email, domain registration, taxes, support plans, backups beyond the stated small storage allowance, and unusual bandwidth. Traffic, job catalog size, resume upload volume, and API activity matter more than account count, so validate with observed metrics before buying capacity.

| Active users | AWS Lightsail baseline | Fly.io regional machines | Render services |
|---:|---:|---:|---:|
| 100 | $40–$60/mo | $55–$85/mo | $55–$90/mo |
| 1,000 | $55–$95/mo | $75–$130/mo | $70–$125/mo |
| 10,000 | $130–$280/mo | $160–$340/mo | $150–$330/mo |

For the lowest-risk small beta, use a Mumbai-region app host, Atlas Flex only while its 5 GB/500-ops ceiling is sufficient, and keep Redis close to API/worker. Move to a separately managed Redis deployment before queue durability or memory isolation becomes a concern. Upgrade Mongo before Flex limits are reached. Keep uploads direct to S3 with short-lived scoped presigned URLs; object storage cost depends on storage, PUT/GET requests, and egress.

## Pricing references (official pages, accessed 2026-10-18)

- [AWS Lightsail bundles](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html) — Linux bundles from $5/month; 2 GB at $12/month.
- [Fly.io machine pricing](https://fly.io/docs/about/pricing/) — shared CPU/RAM and egress prices by region.
- [Render pricing](https://render.com/pricing) and [compute plans](https://render.com/docs/compute-plans) — workspace and service compute; verify Key Value configuration before use.
- [MongoDB Atlas pricing](https://www.mongodb.com/pricing) and [Flex billing limits](https://www.mongodb.com/docs/atlas/billing/atlas-flex-costs/) — Flex $8–$30/month; dedicated starting price depends on region/configuration.
- [Amazon ElastiCache pricing](https://aws.amazon.com/elasticache/pricing/) — Valkey Serverless starts at $6/month; requests and memory affect actual bill.
- [Vercel pricing](https://vercel.com/pricing) — Pro $20/month with included usage credit; additional usage depends on traffic.
- [Amazon Route 53 pricing](https://aws.amazon.com/route53/pricing/) — first hosted zone $0.50/month plus DNS queries.

## Decision and open checks

No host is selected. Before spending, decide who operates Redis, verify `noeviction` and persistence on the exact service/plan, confirm Mumbai/Singapore region availability for every component, and run a Kerala-region latency check. Domain registration cost, S3 CORS deployment, snapshots, and production backup retention require the actual account-specific calculator/configuration. User count by itself is not sufficient to size the system.
