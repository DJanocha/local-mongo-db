import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, run } from "../src/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE_ROOT = path.join(__dirname, "..", ".smoke");

type SmokeEnvKey = "DATABASE_URL" | "DB_SOURCE";

void run(
  defineConfig<SmokeEnvKey>({
    containerName: "mongodb-smoke",
    port: 27099,
    localDbPath: path.join(SMOKE_ROOT, "localDb"),
    envLocalPath: path.join(SMOKE_ROOT, ".env.local"),
    envPath: path.join(SMOKE_ROOT, ".env"),
    envVariables: ({ port }) => [
      { envKey: "DATABASE_URL", value: `mongodb://localhost:${port}` },
      { envKey: "DB_SOURCE", value: "local" },
    ],
    enablePushToHosted: false,
    enableHostedDbDuplication: false,
  }),
);
