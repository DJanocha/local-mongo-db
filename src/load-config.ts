import fs from "node:fs";
import path from "node:path";

import { createJiti } from "jiti";

import type { LocalMongoConfig } from "./define-config";

export const CONFIG_FILE_BASENAMES = [
  "local-mongo-db.config.ts",
  "local-mongo-db.config.js",
  "local-mongo-db.config.mjs",
] as const;

export type LoadedConfig = {
  config: LocalMongoConfig;
  configFilePath: string;
};

export type LoadConfigOptions = {
  /** Explicit `--config <path>` value. Resolved against `cwd`. */
  configPath?: string;
  /** Working directory used for relative-path resolution. Defaults to `process.cwd()`. */
  cwd?: string;
};

const importDefault = async (absPath: string): Promise<unknown> => {
  const jiti = createJiti(absPath, { interopDefault: true, fsCache: false });
  const loaded = (await jiti.import(absPath)) as
    | LocalMongoConfig
    | { default?: LocalMongoConfig };
  if (
    loaded &&
    typeof loaded === "object" &&
    "default" in loaded &&
    loaded.default
  ) {
    return loaded.default;
  }
  return loaded;
};

const isConfigShape = (value: unknown): value is LocalMongoConfig =>
  typeof value === "object" &&
  value !== null &&
  "envKeyMapper" in value &&
  "dbSnapshotsPath" in value;

/**
 * Resolve a local-mongo-db config file: explicit `--config` path first, then
 * auto-discover one of `CONFIG_FILE_BASENAMES` in `cwd`. Throws if neither
 * is found or the loaded module's default export doesn't look like a config.
 */
export async function loadConfig(
  options: LoadConfigOptions = {},
): Promise<LoadedConfig> {
  const cwd = options.cwd ?? process.cwd();

  if (options.configPath) {
    const absPath = path.isAbsolute(options.configPath)
      ? options.configPath
      : path.resolve(cwd, options.configPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Config file not found at "${absPath}"`);
    }
    const loaded = await importDefault(absPath);
    if (!isConfigShape(loaded)) {
      throw new Error(
        `Config file at "${absPath}" must default-export a LocalMongoConfig (object with envKeyMapper + dbSnapshotsPath).`,
      );
    }
    return { config: loaded, configFilePath: absPath };
  }

  for (const basename of CONFIG_FILE_BASENAMES) {
    const absPath = path.join(cwd, basename);
    if (fs.existsSync(absPath)) {
      const loaded = await importDefault(absPath);
      if (!isConfigShape(loaded)) {
        throw new Error(
          `Config file at "${absPath}" must default-export a LocalMongoConfig (object with envKeyMapper + dbSnapshotsPath).`,
        );
      }
      return { config: loaded, configFilePath: absPath };
    }
  }

  throw new Error(
    `No local-mongo-db config found in "${cwd}". Looked for: ${CONFIG_FILE_BASENAMES.join(", ")}. Pass --config <path> to use a custom location.`,
  );
}
