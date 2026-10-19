import { bootstrap } from "./main/server.js";

export { bootstrap };

if (process.env.NODE_ENV !== "test") {
  bootstrap().catch((err: unknown) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
