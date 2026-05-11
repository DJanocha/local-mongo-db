# @danieljanocha/local-mongo-db

A reusable CLI for managing a local MongoDB container (via podman), pulling/pushing data to a hosted Atlas, taking BSON snapshots, and injecting the right env vars into your local environment file while it runs.

It replaces the copy-pasted `local-db.ts` script that ends up in every monorepo. You drop in a tiny entry script, configure it with `defineConfig`, and `pnpm local:db` keeps working.

## Install

```sh
pnpm add -D @danieljanocha/local-mongo-db tsx
```

You'll also need `podman`, `mongodump`, `mongorestore`, and `mongosh` on your PATH.

## Use

Create `scripts/local-db.ts`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, run } from "@danieljanocha/local-mongo-db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

void run(
  defineConfig({
    containerName: "mongodb",
    port: 27011,
    version: "6.0.13-ubi8",
    localDbPath: path.join(__dirname, "../localDb"),
    envLocalPath: path.join(WORKSPACE_ROOT, ".env.local"),
    envPath: path.join(WORKSPACE_ROOT, ".env"),
    envVariables: ({ port }) => [
      { envKey: "DATABASE_URL", value: `mongodb://localhost:${port}` },
      { envKey: "DB_SOURCE", value: "local" },
    ],
    enablePushToHosted: true,
    enableHostedDbDuplication: true,
  }),
);
```

Then in `package.json`:

```jsonc
{
  "scripts": {
    "local:db": "pnpm with-env tsx scripts/local-db.ts"
  }
}
```

Run `pnpm local:db` — you get the interactive wizard. Pass flags to skip it.

## Type-safe env keys

If you already have a typed env schema (e.g. `@t3-oss/env-nextjs`), pass its key union as a generic so typos in `envKey` become type errors:

```ts
import type { env } from "@repo/env/web";

void run(
  defineConfig<keyof typeof env & string>({
    // ...
    envVariables: ({ port }) => [
      { envKey: "DATABASE_URL", value: `mongodb://localhost:${port}` },
      // { envKey: "DB_URRL", value: "..." }, // ← would error: unknown key
    ],
  }),
);
```

## Configuration reference

| Field | Default | Description |
|---|---|---|
| `containerName` | `"mongodb"` | Podman container name. |
| `port` | `27017` | Local TCP port. Overridable at runtime with `--port`. |
| `version` | `"6.0.13-ubi8"` | `mongodb-community-server` image tag. |
| `localDbPath` | — | Directory for `.bson` snapshots and the `dump/` working dir. |
| `envLocalPath` | — | Env file the CLI writes local-mode variables into (e.g. `.env.local`). |
| `envPath` | — | Env file the CLI reads the hosted URI from (e.g. `.env`). |
| `envVariables` | — | Static list or factory `(ctx) => list` of `{ envKey, value }` entries to write/strip. |
| `localConnectionEnvKey` | `"DATABASE_URL"` | Key read from `envLocalPath` for the local URI (when pushing). |
| `hostedConnectionEnvKey` | `"DATABASE_URL"` | Key read from `envPath` for the hosted Atlas URI. |
| `enablePushToHosted` | `false` | Reveal the `push` action and `--push` / `--push-current` flags. |
| `enableHostedDbDuplication` | `false` | Reveal the `duplicate-hosted-db` action. |
| `namespaceTransform` | — | `{ from, to }` forwarded as `--nsFrom` / `--nsTo` to `mongorestore`. |

## CLI flags

```
--list             List all available snapshots
--load-last        Load the most recent DB snapshot
--load <slug>      Load a specific snapshot by slug
--save-as <name>   Save the current database state with the given name
--start            Start local MongoDB without the interactive wizard
--push <slug>      DANGEROUS: push a snapshot to hosted DB (requires confirmation)
--push-current     DANGEROUS: push current local DB to hosted (requires confirmation)
-p, --port <n>     MongoDB port (overrides the config default)
```

`--push` and `--push-current` only appear when `enablePushToHosted: true`.

With no flags, an interactive wizard appears. `push` and `duplicate-hosted-db` choices appear only when their corresponding `enable*` flag is on.

## What "env injection" means

While the local DB is running, the CLI **appends** your `envVariables` entries to `envLocalPath`. On Ctrl+C / SIGTERM it **strips** those same keys back out. The "local override" tricks your app into talking to the local container while leaving your hosted `envPath` untouched.

Use different keys per project — `DATABASE_URL`, `DB_URI`, `DB_URL`, `MONGO_URL`, `NEXT_PUBLIC_DB_SOURCE` etc. — they're all just strings in your config.

## License

MIT
