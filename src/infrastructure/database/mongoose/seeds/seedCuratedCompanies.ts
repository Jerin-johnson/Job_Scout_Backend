import mongoose from "mongoose";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const CURATED_COMPANIES = [
  // Greenhouse Tier-1 & Leaders
  {
    platform: "greenhouse",
    slug: "cloudflare",
    name: "Cloudflare",
    domain: "cloudflare.com",
    careersUrl: "https://www.cloudflare.com/careers/",
    tier: "Global Tech / Infrastructure",
    location: "San Francisco, Austin, London, Singapore, Remote",
  },
  {
    platform: "greenhouse",
    slug: "stripe",
    name: "Stripe",
    domain: "stripe.com",
    careersUrl: "https://stripe.com/jobs",
    tier: "Fintech Leader",
    location: "San Francisco, Seattle, Dublin, Singapore, Remote",
  },
  {
    platform: "greenhouse",
    slug: "figma",
    name: "Figma",
    domain: "figma.com",
    careersUrl: "https://www.figma.com/careers/",
    tier: "Design / Productivity",
    location: "San Francisco, New York, London, Remote",
  },
  {
    platform: "greenhouse",
    slug: "datadog",
    name: "Datadog",
    domain: "datadoghq.com",
    careersUrl: "https://www.datadoghq.com/careers/",
    tier: "Cloud Monitoring",
    location: "New York, Boston, Paris, Remote",
  },
  {
    platform: "greenhouse",
    slug: "discord",
    name: "Discord",
    domain: "discord.com",
    careersUrl: "https://discord.com/careers",
    tier: "Consumer / Real-Time Tech",
    location: "San Francisco, Remote",
  },
  {
    platform: "greenhouse",
    slug: "reddit",
    name: "Reddit",
    domain: "redditinc.com",
    careersUrl: "https://www.redditinc.com/careers",
    tier: "Social / Community",
    location: "San Francisco, New York, Remote",
  },
  {
    platform: "greenhouse",
    slug: "robinhood",
    name: "Robinhood",
    domain: "robinhood.com",
    careersUrl: "https://robinhood.com/careers",
    tier: "Fintech",
    location: "Menlo Park, New York, Remote",
  },
  {
    platform: "greenhouse",
    slug: "instacart",
    name: "Instacart",
    domain: "instacart.com",
    careersUrl: "https://instacart.careers/",
    tier: "Marketplace / Logistics",
    location: "San Francisco, Toronto, Remote",
  },
  {
    platform: "greenhouse",
    slug: "pinterest",
    name: "Pinterest",
    domain: "pinterest.com",
    careersUrl: "https://www.pinterestcareers.com/",
    tier: "Consumer Tech",
    location: "San Francisco, Seattle, Dublin, Remote",
  },
  {
    platform: "greenhouse",
    slug: "mongodb",
    name: "MongoDB",
    domain: "mongodb.com",
    careersUrl: "https://www.mongodb.com/careers",
    tier: "Data Platform",
    location: "New York, Austin, Bengaluru, Dublin, Remote",
  },
  {
    platform: "greenhouse",
    slug: "elastic",
    name: "Elastic",
    domain: "elastic.co",
    careersUrl: "https://www.elastic.co/about/careers",
    tier: "Search & Observability",
    location: "Mountain View, Amsterdam, Remote",
  },
  {
    platform: "greenhouse",
    slug: "gitlab",
    name: "GitLab",
    domain: "gitlab.com",
    careersUrl: "https://about.gitlab.com/jobs/",
    tier: "DevOps / Remote Pioneer",
    location: "Remote Worldwide",
  },
  {
    platform: "greenhouse",
    slug: "brex",
    name: "Brex",
    domain: "brex.com",
    careersUrl: "https://www.brex.com/careers",
    tier: "Fintech Unicorn",
    location: "San Francisco, New York, Remote",
  },
  {
    platform: "greenhouse",
    slug: "coinbase",
    name: "Coinbase",
    domain: "coinbase.com",
    careersUrl: "https://www.coinbase.com/careers",
    tier: "Crypto / Web3",
    location: "Remote Worldwide",
  },
  {
    platform: "greenhouse",
    slug: "gusto",
    name: "Gusto",
    domain: "gusto.com",
    careersUrl: "https://gusto.com/about/careers",
    tier: "Payroll / HR Tech",
    location: "San Francisco, Denver, Remote",
  },
  {
    platform: "greenhouse",
    slug: "affirm",
    name: "Affirm",
    domain: "affirm.com",
    careersUrl: "https://www.affirm.com/careers",
    tier: "Fintech",
    location: "San Francisco, Chicago, Remote",
  },
  {
    platform: "greenhouse",
    slug: "chime",
    name: "Chime",
    domain: "chime.com",
    careersUrl: "https://www.chime.com/careers/",
    tier: "Digital Banking",
    location: "San Francisco, Chicago, Remote",
  },
  {
    platform: "greenhouse",
    slug: "inmobi",
    name: "InMobi",
    domain: "inmobi.com",
    careersUrl: "https://www.inmobi.com/company/careers",
    tier: "Top India Tech Unicorn",
    location: "Bengaluru, India / San Francisco / Remote",
  },

  // Ashby AI Frontier & Modern Unicorns
  {
    platform: "ashby",
    slug: "openai",
    name: "OpenAI",
    domain: "openai.com",
    careersUrl: "https://openai.com/careers",
    tier: "Frontier AI",
    location: "San Francisco, New York, London, Tokyo",
  },
  {
    platform: "ashby",
    slug: "linear",
    name: "Linear",
    domain: "linear.app",
    careersUrl: "https://linear.app/careers",
    tier: "Productivity & Software",
    location: "San Francisco, Remote",
  },
  {
    platform: "ashby",
    slug: "ramp",
    name: "Ramp",
    domain: "ramp.com",
    careersUrl: "https://ramp.com/careers",
    tier: "Fintech Unicorn",
    location: "New York, San Francisco, Remote",
  },
  {
    platform: "ashby",
    slug: "perplexity",
    name: "Perplexity AI",
    domain: "perplexity.ai",
    careersUrl: "https://www.perplexity.ai/careers",
    tier: "Conversational Search / AI",
    location: "San Francisco, Remote",
  },
  {
    platform: "ashby",
    slug: "replit",
    name: "Replit",
    domain: "replit.com",
    careersUrl: "https://replit.com/careers",
    tier: "AI Development / Cloud IDE",
    location: "San Francisco, Remote",
  },
  {
    platform: "ashby",
    slug: "cohere",
    name: "Cohere",
    domain: "cohere.com",
    careersUrl: "https://cohere.com/careers",
    tier: "Enterprise AI",
    location: "Toronto, San Francisco, London, Remote",
  },
  {
    platform: "ashby",
    slug: "elevenlabs",
    name: "ElevenLabs",
    domain: "elevenlabs.io",
    careersUrl: "https://elevenlabs.io/careers",
    tier: "Voice AI & Audio",
    location: "New York, London, Remote",
  },
  {
    platform: "ashby",
    slug: "cursor",
    name: "Cursor",
    domain: "cursor.com",
    careersUrl: "https://www.cursor.com/careers",
    tier: "AI Coding Assistant",
    location: "San Francisco, Remote",
  },
  {
    platform: "ashby",
    slug: "supabase",
    name: "Supabase",
    domain: "supabase.com",
    careersUrl: "https://supabase.com/careers",
    tier: "Open Source Backend",
    location: "Remote Worldwide",
  },
  {
    platform: "ashby",
    slug: "resend",
    name: "Resend",
    domain: "resend.com",
    careersUrl: "https://resend.com/careers",
    tier: "Developer Infrastructure",
    location: "Remote Worldwide",
  },
  {
    platform: "ashby",
    slug: "modal",
    name: "Modal",
    domain: "modal.com",
    careersUrl: "https://modal.com/careers",
    tier: "AI Cloud Compute",
    location: "New York, Remote",
  },
  {
    platform: "ashby",
    slug: "render",
    name: "Render",
    domain: "render.com",
    careersUrl: "https://render.com/careers",
    tier: "Cloud Platform",
    location: "San Francisco, Remote",
  },

  // Lever Leaders
  {
    platform: "lever",
    slug: "spotify",
    name: "Spotify",
    domain: "spotify.com",
    careersUrl: "https://www.lifeatspotify.com/",
    tier: "Streaming Media & Audio",
    location: "Stockholm, New York, London, Remote",
  },
  {
    platform: "greenhouse",
    slug: "canonical",
    name: "Canonical",
    domain: "canonical.com",
    careersUrl: "https://canonical.com/careers",
    tier: "Open Source / Linux",
    location: "Remote Worldwide / London",
  },
  {
    platform: "greenhouse",
    slug: "twilio",
    name: "Twilio",
    domain: "twilio.com",
    careersUrl: "https://www.twilio.com/company/jobs",
    tier: "Communications Cloud",
    location: "Remote / Bengaluru, India / San Francisco",
  },
  {
    platform: "greenhouse",
    slug: "airbnb",
    name: "Airbnb",
    domain: "airbnb.com",
    careersUrl: "https://careers.airbnb.com/",
    tier: "Travel & Hospitality Tech",
    location: "Remote / San Francisco",
  },
  {
    platform: "greenhouse",
    slug: "lyft",
    name: "Lyft",
    domain: "lyft.com",
    careersUrl: "https://www.lyft.com/careers",
    tier: "Transportation & Autonomous Tech",
    location: "San Francisco / New York / Remote",
  },
  {
    platform: "greenhouse",
    slug: "okta",
    name: "Okta",
    domain: "okta.com",
    careersUrl: "https://www.okta.com/company/careers/",
    tier: "Enterprise Identity & Security",
    location: "San Francisco / Remote Worldwide",
  },
  {
    platform: "greenhouse",
    slug: "pagerduty",
    name: "PagerDuty",
    domain: "pagerduty.com",
    careersUrl: "https://www.pagerduty.com/careers/",
    tier: "Incident Management & Cloud Ops",
    location: "San Francisco / Remote",
  },
  {
    platform: "greenhouse",
    slug: "samsara",
    name: "Samsara",
    domain: "samsara.com",
    careersUrl: "https://www.samsara.com/company/careers/",
    tier: "Connected Operations Cloud / IoT",
    location: "San Francisco / London / Remote",
  },
  {
    platform: "lever",
    slug: "meesho",
    name: "Meesho",
    domain: "meesho.com",
    careersUrl: "https://www.meesho.io/careers",
    tier: "Top India E-commerce Unicorn",
    location: "Bengaluru, India / Remote",
  },
  {
    platform: "lever",
    slug: "palantir",
    name: "Palantir Technologies",
    domain: "palantir.com",
    careersUrl: "https://www.palantir.com/careers/",
    tier: "Enterprise AI & Defense Analytics",
    location: "Denver / New York / London / Remote",
  },
];

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not defined");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database connection not ready");

  console.log(`Seeding ${CURATED_COMPANIES.length} curated employer boards...`);

  const trackedColl = db.collection("trackedcompanies");
  let upsertedCount = 0;

  for (const c of CURATED_COMPANIES) {
    const res = await trackedColl.updateOne(
      { platform: c.platform, slug: c.slug },
      {
        $set: {
          platform: c.platform,
          slug: c.slug,
          name: c.name,
          domain: c.domain,
          location: c.location,
          tier: c.tier,
          careersUrl: c.careersUrl,
          status: "approved",
          verifiedAt: new Date(),
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
          requestedBy: null,
        },
      },
      { upsert: true },
    );
    if (res.upsertedCount || res.modifiedCount) upsertedCount++;
  }

  console.log(`Seeded/Updated ${upsertedCount} tracked companies successfully.`);

  // Enable sources in jobsources collection
  const sourcesColl = db.collection("jobsources");
  for (const key of ["greenhouse", "ashby", "lever", "jobicy"]) {
    await sourcesColl.updateOne(
      { key },
      {
        $set: {
          approved: true,
          enabled: true,
          activationStatus: "approved_active",
          updatedAt: new Date(),
        },
      },
    );
    console.log(`Source [${key}] approved and enabled in registry.`);
  }

  await mongoose.disconnect();
  console.log("Seeding complete!");
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
