import { BaseJobAdapter } from "./baseAdapter.js";

export class MockBoardAdapter extends BaseJobAdapter {
  constructor() {
    super("mock_public_board", true);
  }

  async fetchJobs() {
    const rawJobs = [
      {
        title: "Staff Backend Engineer",
        company: "Acme Global",
        location: "Remote",
        remoteType: "remote",
        salaryRange: { min: 170000, max: 210000, currency: "USD" },
        requirements: ["Node.js", "Distributed Systems", "MongoDB", "Redis", "Kafka"],
        tags: ["backend", "node", "systems"],
        rawDescription:
          "Join our core payment infrastructure team building scalable Node.js microservices. Experience with Redis caching and distributed data stores required.",
        sourceUrl: "https://mockboard.example.com/jobs/1",
      },
      {
        title: "Senior Full Stack Architect",
        company: "Datadog Cloud",
        location: "New York, NY",
        remoteType: "hybrid",
        salaryRange: { min: 165000, max: 195000, currency: "USD" },
        requirements: ["JavaScript", "TypeScript", "React", "Node.js", "Docker", "Kubernetes"],
        tags: ["fullstack", "cloud", "observability"],
        rawDescription:
          "Design enterprise observability platforms. Strong backend API development with Express and frontend React/Next.js skills required.",
        sourceUrl: "https://mockboard.example.com/jobs/2",
      },
      {
        title: "Principal Platform Engineer",
        company: "Vercel Systems",
        location: "Remote",
        remoteType: "remote",
        salaryRange: { min: 180000, max: 230000, currency: "USD" },
        requirements: ["Edge Compute", "Node.js", "Next.js", "AWS", "Performance Tuning"],
        tags: ["platform", "edge", "serverless"],
        rawDescription:
          "Help scale our global Edge Runtime. Focus on low latency, request caching, and resilient microservices.",
        sourceUrl: "https://mockboard.example.com/jobs/3",
      },
      {
        title: "Junior QA Tester",
        company: "Legacy Enterprise Ltd",
        location: "Chicago, IL",
        remoteType: "onsite",
        salaryRange: { min: 55000, max: 70000, currency: "USD" },
        requirements: ["Manual Testing", "Jira"],
        tags: ["qa", "manual"],
        rawDescription: "Entry-level manual testing position for desktop software.",
        sourceUrl: "https://mockboard.example.com/jobs/4",
      },
    ];

    return rawJobs.map((j) => ({
      ...j,
      contentHash: this.generateContentHash(j),
      sourceBoard: this.name,
      postedAt: new Date(),
    }));
  }
}
