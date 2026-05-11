export type EnvVariable<EnvKey extends string = string> = {
  envKey: EnvKey;
  value: string;
};

export type EnvVariablesFactory<EnvKey extends string = string> = (ctx: {
  port: number;
}) => readonly EnvVariable<EnvKey>[];

export type NamespaceTransform = {
  from: string;
  to: string;
};

export type LocalMongoConfig<EnvKey extends string = string> = {
  /** Podman container name. Defaults to `"mongodb"`. */
  containerName?: string;
  /** Local TCP port exposed by the container. Defaults to `27017`. */
  port?: number;
  /** MongoDB community-server image tag. Defaults to `"6.0.13-ubi8"`. */
  version?: string;

  /** Directory where `.bson` snapshots and the `dump/` working dir live. */
  localDbPath: string;
  /** Path to the file we inject local-mode env variables into (e.g. `.env.local`). */
  envLocalPath: string;
  /** Path to the env file we read the hosted Atlas URI from (e.g. `.env`). */
  envPath: string;

  /**
   * Env variables to add when the local DB starts and remove during cleanup.
   * Either a static list, or a factory called with the resolved port so
   * connection strings can be templated.
   */
  envVariables:
    | readonly EnvVariable<EnvKey>[]
    | EnvVariablesFactory<EnvKey>;

  /** Env key read from `envPath` for the hosted Atlas URI. Defaults to `"DATABASE_URL"`. */
  hostedConnectionEnvKey?: string;
  /** Env key read from `envLocalPath` for the local DB URI. Defaults to `"DATABASE_URL"`. */
  localConnectionEnvKey?: string;

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

export type ResolvedLocalMongoConfig<EnvKey extends string = string> = Required<
  Pick<
    LocalMongoConfig<EnvKey>,
    | "containerName"
    | "port"
    | "version"
    | "localDbPath"
    | "envLocalPath"
    | "envPath"
    | "hostedConnectionEnvKey"
    | "localConnectionEnvKey"
    | "enablePushToHosted"
    | "enableHostedDbDuplication"
  >
> & {
  envVariables: EnvVariablesFactory<EnvKey>;
  namespaceTransform?: NamespaceTransform;
};

const DEFAULTS = {
  containerName: "mongodb",
  port: 27017,
  version: "6.0.13-ubi8",
  hostedConnectionEnvKey: "DATABASE_URL",
  localConnectionEnvKey: "DATABASE_URL",
  enablePushToHosted: false,
  enableHostedDbDuplication: false,
} as const;

export function resolveConfig<EnvKey extends string>(
  config: LocalMongoConfig<EnvKey>,
): ResolvedLocalMongoConfig<EnvKey> {
  const envVariables: EnvVariablesFactory<EnvKey> =
    typeof config.envVariables === "function"
      ? config.envVariables
      : () => config.envVariables as readonly EnvVariable<EnvKey>[];

  return {
    containerName: config.containerName ?? DEFAULTS.containerName,
    port: config.port ?? DEFAULTS.port,
    version: config.version ?? DEFAULTS.version,
    localDbPath: config.localDbPath,
    envLocalPath: config.envLocalPath,
    envPath: config.envPath,
    hostedConnectionEnvKey:
      config.hostedConnectionEnvKey ?? DEFAULTS.hostedConnectionEnvKey,
    localConnectionEnvKey:
      config.localConnectionEnvKey ?? DEFAULTS.localConnectionEnvKey,
    enablePushToHosted:
      config.enablePushToHosted ?? DEFAULTS.enablePushToHosted,
    enableHostedDbDuplication:
      config.enableHostedDbDuplication ?? DEFAULTS.enableHostedDbDuplication,
    envVariables,
    namespaceTransform: config.namespaceTransform,
  };
}

/**
 * Identity helper for type-safe configuration of `@danieljanocha/local-mongo-db`.
 *
 * Pass a string-union type parameter (typically `keyof typeof env`) to narrow
 * `envVariables[].envKey` to your project's env schema so typos surface at
 * compile time.
 */
export function defineConfig<EnvKey extends string = string>(
  config: LocalMongoConfig<EnvKey>,
): LocalMongoConfig<EnvKey> {
  return config;
}
