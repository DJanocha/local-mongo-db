import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // MMS first-run downloads mongod (~100MB). Default 5s timeout is too tight.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Run test files sequentially so two MMS instances don't compete for the
    // same ephemeral port and the mongodump/mongorestore binaries don't
    // collide on shared dump dirs.
    fileParallelism: false,
    // No globals — explicit imports are clearer.
    globals: false,
  },
});
