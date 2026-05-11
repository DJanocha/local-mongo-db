import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveConfig } from "../src/define-config";
import { LocalMongoManager } from "../src/manager";
import { cleanupTempDir, createTempDir, writeEnvFile } from "./helpers";

const makeManager = (overrides: {
  envPath: string;
  envLocalPath: string;
  localDbPath: string;
  port?: number;
  localConnectionEnvKey?: string;
  hostedConnectionEnvKey?: string;
}) =>
  new LocalMongoManager(
    resolveConfig({
      envPath: overrides.envPath,
      envLocalPath: overrides.envLocalPath,
      localDbPath: overrides.localDbPath,
      port: overrides.port,
      localConnectionEnvKey: overrides.localConnectionEnvKey,
      hostedConnectionEnvKey: overrides.hostedConnectionEnvKey,
      envVariables: ({ port }) => [
        { envKey: "DATABASE_URL", value: `mongodb://localhost:${port}` },
        { envKey: "DB_SOURCE", value: "local" },
      ],
    }),
    { registerSignalHandlers: false },
  );

describe("LocalMongoManager lifecycle (no MMS)", () => {
  let tmpDir: string;
  let envPath: string;
  let envLocalPath: string;
  let localDbPath: string;

  beforeEach(() => {
    tmpDir = createTempDir("lifecycle");
    envPath = path.join(tmpDir, ".env");
    envLocalPath = path.join(tmpDir, ".env.local");
    localDbPath = path.join(tmpDir, "localDb");
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  describe("constructor", () => {
    it("creates localDbPath and dump/ if missing", () => {
      expect(fs.existsSync(localDbPath)).toBe(false);
      makeManager({ envPath, envLocalPath, localDbPath });
      expect(fs.existsSync(localDbPath)).toBe(true);
      expect(fs.existsSync(path.join(localDbPath, "dump"))).toBe(true);
    });

    it("does NOT install signal handlers when registerSignalHandlers: false", () => {
      const before = process.listenerCount("SIGINT");
      makeManager({ envPath, envLocalPath, localDbPath });
      const after = process.listenerCount("SIGINT");
      expect(after).toBe(before);
    });
  });

  describe("getHostedAtlasUri (via isTargetHosted)", () => {
    it("throws when envPath does not exist", () => {
      const manager = makeManager({ envPath, envLocalPath, localDbPath });
      expect(() => manager.isTargetHosted()).toThrow(
        /Environment file not found/,
      );
    });

    it("throws when the configured key is missing", () => {
      writeEnvFile(envPath, [{ envKey: "OTHER_KEY", value: "x" }]);
      const manager = makeManager({ envPath, envLocalPath, localDbPath });
      expect(() => manager.isTargetHosted()).toThrow(
        /DATABASE_URL not found/,
      );
    });

    it("reads a custom hostedConnectionEnvKey", () => {
      writeEnvFile(envPath, [
        { envKey: "MONGO_URL", value: "mongodb+srv://x.mongodb.net/y" },
      ]);
      const manager = makeManager({
        envPath,
        envLocalPath,
        localDbPath,
        hostedConnectionEnvKey: "MONGO_URL",
      });
      expect(manager.isTargetHosted()).toBe(true);
    });
  });

  describe("list", () => {
    it("returns empty array when no snapshots exist", () => {
      const manager = makeManager({ envPath, envLocalPath, localDbPath });
      expect(manager.list()).toEqual([]);
    });

    it("returns sorted slugs (date-prefixed names sort chronologically)", () => {
      const manager = makeManager({ envPath, envLocalPath, localDbPath });
      fs.writeFileSync(
        path.join(localDbPath, "2024-01-01_00-00-00__alpha.bson"),
        "",
      );
      fs.writeFileSync(
        path.join(localDbPath, "2025-06-15_12-00-00__beta.bson"),
        "",
      );
      fs.writeFileSync(path.join(localDbPath, "not-a-snapshot.txt"), "");
      expect(manager.list()).toEqual([
        "2024-01-01_00-00-00__alpha",
        "2025-06-15_12-00-00__beta",
      ]);
    });
  });
});
