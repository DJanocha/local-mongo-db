# @danieljanocha/local-mongo-db

A reusable CLI for managing a local MongoDB container (via podman), pulling/pushing data to a hosted Atlas, taking BSON snapshots, and injecting the right env vars into your local environment file while it runs.

You write one `local-mongo-db.config.ts` and add one line to `package.json`. Done. No entry script, no `__dirname` plumbing.

## Install

```sh
pnpm add -D @danieljanocha/local-mongo-db
```

You'll also need `podman`, `mongodump`, `mongorestore`, and `mongosh` on your PATH.

## Use

### 1. Add the script

```jsonc
// package.json
{
  "scripts": {
    "db:local": "local-mongo-db"
    // or, with explicit path: "local-mongo-db --config ./local-db/config.ts"
  }
}
```

The CLI auto-discovers `local-mongo-db.config.{ts,js,mjs}` in the current working directory.

### 2. Create the config

```ts
// local-mongo-db.config.ts
import { buildLocalMongoEnv, defineConfig } from "@danieljanocha/local-mongo-db/env";

export const localMongoEnv = buildLocalMongoEnv({
  dbUrl: "DATABASE_URL",
  // or mirror into legacy keys: dbUrl: ["DATABASE_URL", "MONGO_URI"],
  dbSource: "NEXT_PUBLIC_DB_SOURCE", // optional label
});

export default defineConfig({
  containerName: "mongodb",
  port: 27011,
  version: "6.0.13-ubi8",
  dbSnapshotsPath: "./snapshots", // resolved relative to THIS file
  envLocalPath: "../.env.local",
  envPath: "../.env",
  envKeyMapper: localMongoEnv.envKeyMapper,
  enablePushToHosted: true,
  enableHostedDbDuplication: true,
});
```

All path fields (`dbSnapshotsPath`, `envLocalPath`, `envPath`) are resolved **relative to the config file's directory** — no `__dirname` / `WORKSPACE_ROOT` math needed. Absolute paths are kept as-is.

Run `pnpm db:local` to launch the interactive wizard. Pass flags (`--list`, `--load-last`, etc.) to skip it.

### Two entry points

| Import | Contains | Use it for |
|---|---|---|
| `@danieljanocha/local-mongo-db` | Everything, incl. the CLI and the `mongodb` driver (Node-only) | The CLI itself; Node-only scripts. |
| `@danieljanocha/local-mongo-db/env` | `buildLocalMongoEnv`, `defineConfig`, `resolveConfig` + types — zero `mongodb` in the import graph | Your `local-mongo-db.config.ts` and anything a browser/edge bundle can reach. |

Always import from `/env` in `local-mongo-db.config.ts`. Frameworks like Next.js bundle whatever your `env.ts` transitively imports, and `env.ts` imports `localMongoEnv` from the config file — so a `.` import there pulls the `mongodb` driver into the client bundle and breaks the build with `Module not found: Can't resolve 'net'`.

## Type-safe env keys with t3-oss

`buildLocalMongoEnv` returns a Zod object schema alongside the mapper. Spread its `.shape` into your `@t3-oss/env-*` setup and the same env keys validate at startup:

```ts
// env.ts
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { localMongoEnv } from "../local-mongo-db.config";

export const env = createEnv({
  server: {
    ...localMongoEnv.schema.shape, // DATABASE_URL etc.
    OTHER_SERVER_KEY: z.string(),
  },
  client: {
    NEXT_PUBLIC_OTHER: z.string(),
  },
  // ...
});
```

Single source of truth: the env-var names live in your `local-mongo-db.config.ts`, both the runtime injector and your env schema derive from the same builder call.

## Configuration reference

| Field | Default | Description |
|---|---|---|
| `containerName` | `"mongodb"` | Podman container name. |
| `port` | `27017` | Local TCP port. Overridable at runtime with `--port`. |
| `version` | `"6.0.13-ubi8"` | `mongodb-community-server` image tag. |
| `dbSnapshotsPath` | — | Directory for `.bson` snapshots and the `dump/` working dir. Config-file-relative. |
| `envLocalPath` | — | Env file the CLI writes local-mode variables into (e.g. `.env.local`). Config-file-relative. |
| `envPath` | — | Env file the CLI reads the hosted Atlas URI from (e.g. `.env`). Config-file-relative. |
| `envKeyMapper` | — | `{ dbUrl: string \| string[]; dbSource?: string \| string[] }`. Canonical → env-var-name map. |
| `extraEnvVariables` | — | Optional `({ port }) => [{ envKey, value }]` for env vars outside the canonical mapper. |
| `hostedDbUrlEnvKey` | `"DATABASE_URL"` | Key read from `envPath` for the hosted Atlas URI. |
| `enablePushToHosted` | `false` | Reveal the `push` action and `--push` / `--push-current` flags. |
| `enableHostedDbDuplication` | `false` | Reveal the `duplicate-hosted-db` action. |
| `namespaceTransform` | — | `{ from, to }` forwarded as `--nsFrom` / `--nsTo` to `mongorestore`. |

## CLI flags

```
--config <path>    Use a specific config file (overrides auto-discovery)
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

While the local DB is running, the CLI **appends** every mapper-derived env key (plus `extraEnvVariables`) to `envLocalPath`. Each `envKeyMapper.dbUrl` entry gets `mongodb://localhost:${port}`; each `envKeyMapper.dbSource` entry gets `"local"`. On Ctrl+C / SIGTERM it **strips** those same keys back out. The "local override" tricks your app into talking to the local container while leaving your hosted `envPath` untouched.

## License

MIT
