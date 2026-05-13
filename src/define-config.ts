import path from "node:path";

import type {
  EnvKeyOrKeys,
  LocalMongoEnvKeyMapper,
} from "./build-local-mongo-env";

export type EnvVariable = { envKey: string; value: string };

export type EnvVariablesFactory = (ctx: {
  port: number;
}) => readonly EnvVariable[];

export type NamespaceTransform = {
  from: string;
  to: string;
};

export type LocalMongoEnvKeyMapperInput = {
  dbUrl: EnvKeyOrKeys;
  dbSource?: EnvKeyOrKeys;
};

export type LocalMongoConfig = {
  /** Podman container name. Defaults to `"mongodb"`. */
  containerName?: string;
  /** Local TCP port exposed by the container. Defaults to `27017`. */
  port?: number;
  /** MongoDB community-server image tag. Defaults to `"6.0.13-ubi8"`. */
  version?: string;

  /**
   * Directory where `.bson` snapshots and the `dump/` working dir live.
   * Resolved relative to the config file's directory when loaded via the
   * `local-mongo-db` CLI; otherwise treated as-is.
   */
  dbSnapshotsPath: string;
  /**
   * Path to the env file the CLI injects local-mode env variables into
   * (e.g. `.env.local`). Resolved relative to the config file when loaded
   * via the CLI.
   */
  envLocalPath: string;
  /**
   * Path to the env file the CLI reads the hosted Atlas URI from
   * (e.g. `.env`). Resolved relative to the config file when loaded via
   * the CLI.
   */
  envPath: string;

  /**
   * Maps canonical local-DB env concepts onto the env-var names your app
   * actually reads. Pass either a single key or an array (legacy mirror).
   * Use `buildLocalMongoEnv` to derive this together with a Zod schema slice.
   */
  envKeyMapper: LocalMongoEnvKeyMapperInput;

  /**
   * Optional escape hatch for env variables that aren't covered by the
   * canonical mapper. Same write/strip lifecycle as the mapper-derived ones.
   */
  extraEnvVariables?: EnvVariablesFactory;

  /** Env key read from `envPath` for the hosted Atlas URI. Defaults to `"DATABASE_URL"`. */
  hostedDbUrlEnvKey?: string;

  /** Enable the `push` action (writes local DB / snapshot to the hosted Atlas). Defaults to `false`. */
  enablePushToHosted?: boolean;
  /** Enable the `duplicate-hosted-db` action. Defaults to `false`. */
  enableHostedDbDuplication?: boolean;

  /**
   * Optional `--nsFrom` / `--nsTo` arguments forwarded to `mongorestore`.
   * Use this if the hosted DB has a different name than the local one and
   * you want restores to remap namespaces.
   */
  namespaceTransform?: NamespaceTransform;
};

/** Fields of `LocalMongoConfig` that have defaults — required after resolution. */
type WithDefaultsKey =
  | "containerName"
  | "port"
  | "version"
  | "hostedDbUrlEnvKey"
  | "enablePushToHosted"
  | "enableHostedDbDuplication";

export type ResolvedLocalMongoConfig =
  // Carry over fields that are already required (paths, namespaceTransform)
  // and drop the ones that get reshaped (envKeyMapper) or folded away
  // (extraEnvVariables → into resolveEnvVariables).
  Omit<LocalMongoConfig, "envKeyMapper" | "extraEnvVariables" | WithDefaultsKey> &
    Required<Pick<LocalMongoConfig, WithDefaultsKey>> & {
      envKeyMapper: LocalMongoEnvKeyMapper;
      /** Computes the full env-var list to write/strip at runtime. */
      resolveEnvVariables: EnvVariablesFactory;
    };

const DEFAULTS = {
  containerName: "mongodb",
  port: 27017,
  version: "6.0.13-ubi8",
  hostedDbUrlEnvKey: "DATABASE_URL",
  enablePushToHosted: false,
  enableHostedDbDuplication: false,
} as const;

const toArray = (value: string | readonly string[] | undefined): string[] => {
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : [...value];
};

const resolvePath = (value: string, configDir: string | undefined): string => {
  if (path.isAbsolute(value)) return value;
  if (!configDir) return value;
  return path.resolve(configDir, value);
};

/**
 * Normalize a `LocalMongoConfig` for runtime use. When `configFilePath` is
 * provided, any relative path fields are resolved against the config file's
 * directory (matches mongogrator semantics). Otherwise paths are kept as-is.
 */
export function resolveConfig(
  config: LocalMongoConfig,
  configFilePath?: string,
): ResolvedLocalMongoConfig {
  const configDir = configFilePath ? path.dirname(configFilePath) : undefined;

  const dbUrlKeys = toArray(config.envKeyMapper.dbUrl);
  const dbSourceKeys = toArray(config.envKeyMapper.dbSource);

  if (dbUrlKeys.length === 0) {
    throw new Error(
      "resolveConfig: `envKeyMapper.dbUrl` must contain at least one env key.",
    );
  }

  const seen = new Set<string>();
  for (const key of [...dbUrlKeys, ...dbSourceKeys]) {
    if (seen.has(key)) {
      throw new Error(
        `resolveConfig: env key "${key}" appears more than once in envKeyMapper.`,
      );
    }
    seen.add(key);
  }

  const extras = config.extraEnvVariables;

  const resolveEnvVariables: EnvVariablesFactory = ({ port }) => {
    const localUri = `mongodb://localhost:${port}`;
    const fromMapper: EnvVariable[] = [
      ...dbUrlKeys.map((envKey) => ({ envKey, value: localUri })),
      ...dbSourceKeys.map((envKey) => ({ envKey, value: "local" })),
    ];
    const fromExtras = extras ? extras({ port }) : [];
    return [...fromMapper, ...fromExtras];
  };

  return {
    containerName: config.containerName ?? DEFAULTS.containerName,
    port: config.port ?? DEFAULTS.port,
    version: config.version ?? DEFAULTS.version,
    dbSnapshotsPath: resolvePath(config.dbSnapshotsPath, configDir),
    envLocalPath: resolvePath(config.envLocalPath, configDir),
    envPath: resolvePath(config.envPath, configDir),
    envKeyMapper: { dbUrl: dbUrlKeys, dbSource: dbSourceKeys },
    hostedDbUrlEnvKey: config.hostedDbUrlEnvKey ?? DEFAULTS.hostedDbUrlEnvKey,
    enablePushToHosted:
      config.enablePushToHosted ?? DEFAULTS.enablePushToHosted,
    enableHostedDbDuplication:
      config.enableHostedDbDuplication ?? DEFAULTS.enableHostedDbDuplication,
    namespaceTransform: config.namespaceTransform,
    resolveEnvVariables,
  };
}

/**
 * Identity helper for type-safe configuration. Authoring helper only —
 * runtime resolution happens inside the CLI / `resolveConfig`.
 */
export function defineConfig(config: LocalMongoConfig): LocalMongoConfig {
  return config;
}
