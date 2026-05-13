import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/load-config";
import { cleanupTempDir, createTempDir } from "./helpers";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

const TS_CONFIG_BODY = `import { defineConfig, buildLocalMongoEnv } from "${path.resolve(TEST_DIR, "..", "src", "index")}";

export const localMongoEnv = buildLocalMongoEnv({ dbUrl: "DATABASE_URL" });

export default defineConfig({
  port: 27999,
  dbSnapshotsPath: "./snapshots",
  envLocalPath: "./.env.local",
  envPath: "./.env",
  envKeyMapper: localMongoEnv.envKeyMapper,
});
`;

const writeTsConfig = (dir: string, basename: string): string => {
  const absPath = path.join(dir, basename);
  fs.writeFileSync(absPath, TS_CONFIG_BODY, "utf-8");
  return absPath;
};

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir("load-config");
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it("loads an explicit --config path (TS, default export)", async () => {
    const configFilePath = writeTsConfig(tmpDir, "custom.config.ts");
    const { config, configFilePath: returnedPath } = await loadConfig({
      configPath: configFilePath,
      cwd: tmpDir,
    });
    expect(returnedPath).toBe(configFilePath);
    expect(config.port).toBe(27999);
    expect(config.envKeyMapper.dbUrl).toEqual(["DATABASE_URL"]);
  });

  it("auto-discovers local-mongo-db.config.ts in cwd", async () => {
    const configFilePath = writeTsConfig(tmpDir, "local-mongo-db.config.ts");
    const { config, configFilePath: returnedPath } = await loadConfig({
      cwd: tmpDir,
    });
    expect(returnedPath).toBe(configFilePath);
    expect(config.dbSnapshotsPath).toBe("./snapshots");
  });

  it("throws when --config path does not exist", async () => {
    await expect(
      loadConfig({
        configPath: path.join(tmpDir, "missing.ts"),
        cwd: tmpDir,
      }),
    ).rejects.toThrow(/not found/);
  });

  it("throws when no config file is discoverable in cwd", async () => {
    await expect(loadConfig({ cwd: tmpDir })).rejects.toThrow(
      /No local-mongo-db config found/,
    );
  });

  it("throws when the loaded module does not look like a config", async () => {
    const absPath = path.join(tmpDir, "bad.config.ts");
    fs.writeFileSync(absPath, `export default { hello: "world" };\n`, "utf-8");
    await expect(
      loadConfig({ configPath: absPath, cwd: tmpDir }),
    ).rejects.toThrow(/must default-export a LocalMongoConfig/);
  });
});
