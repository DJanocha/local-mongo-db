import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveConfig } from "../src/define-config";
import { LocalMongoManager } from "../src/manager";
import { cleanupTempDir, createTempDir, writeEnvFile } from "./helpers";

const makeManager = (overrides: {
  envPath: string;
  envLocalPath: string;
  dbSnapshotsPath: string;
  port?: number;
  hostedDbUrlEnvKey?: string;
  dbUrlKey?: string;
}) =>
  new LocalMongoManager(
    resolveConfig({
      envPath: overrides.envPath,
      envLocalPath: overrides.envLocalPath,
      dbSnapshotsPath: overrides.dbSnapshotsPath,
      port: overrides.port,
      hostedDbUrlEnvKey: overrides.hostedDbUrlEnvKey,
      envKeyMapper: {
        dbUrl: overrides.dbUrlKey ?? "DATABASE_URL",
        dbSource: "DB_SOURCE",
      },
    }),
    { registerSignalHandlers: false },
  );

describe("LocalMongoManager lifecycle (no MMS)", () => {
  let tmpDir: string;
  let envPath: string;
  let envLocalPath: string;
  let dbSnapshotsPath: string;

  beforeEach(() => {
    tmpDir = createTempDir("lifecycle");
    envPath = path.join(tmpDir, ".env");
    envLocalPath = path.join(tmpDir, ".env.local");
    dbSnapshotsPath = path.join(tmpDir, "localDb");
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  describe("constructor", () => {
    it("creates dbSnapshotsPath and dump/ if missing", () => {
      expect(fs.existsSync(dbSnapshotsPath)).toBe(false);
      makeManager({ envPath, envLocalPath, dbSnapshotsPath });
      expect(fs.existsSync(dbSnapshotsPath)).toBe(true);
      expect(fs.existsSync(path.join(dbSnapshotsPath, "dump"))).toBe(true);
    });

    it("does NOT install signal handlers when registerSignalHandlers: false", () => {
      const before = process.listenerCount("SIGINT");
      makeManager({ envPath, envLocalPath, dbSnapshotsPath });
      const after = process.listenerCount("SIGINT");
      expect(after).toBe(before);
    });
  });

  describe("getHostedAtlasUri (via isTargetHosted)", () => {
    it("throws when envPath does not exist", () => {
      const manager = makeManager({ envPath, envLocalPath, dbSnapshotsPath });
      expect(() => manager.isTargetHosted()).toThrow(
        /Environment file not found/,
      );
    });

    it("throws when the configured key is missing", () => {
      writeEnvFile(envPath, [{ envKey: "OTHER_KEY", value: "x" }]);
      const manager = makeManager({ envPath, envLocalPath, dbSnapshotsPath });
      expect(() => manager.isTargetHosted()).toThrow(
        /DATABASE_URL not found/,
      );
    });

    it("reads a custom hostedDbUrlEnvKey", () => {
      writeEnvFile(envPath, [
        { envKey: "MONGO_URL", value: "mongodb+srv://x.mongodb.net/y" },
      ]);
      const manager = makeManager({
        envPath,
        envLocalPath,
        dbSnapshotsPath,
        hostedDbUrlEnvKey: "MONGO_URL",
      });
      expect(manager.isTargetHosted()).toBe(true);
    });
  });

  describe("list", () => {
    it("returns empty array when no snapshots exist", () => {
      const manager = makeManager({ envPath, envLocalPath, dbSnapshotsPath });
      expect(manager.list()).toEqual([]);
    });

    it("returns sorted slugs (date-prefixed names sort chronologically)", () => {
      const manager = makeManager({ envPath, envLocalPath, dbSnapshotsPath });
      fs.writeFileSync(
        path.join(dbSnapshotsPath, "2024-01-01_00-00-00__alpha.bson"),
        "",
      );
      fs.writeFileSync(
        path.join(dbSnapshotsPath, "2025-06-15_12-00-00__beta.bson"),
        "",
      );
      fs.writeFileSync(path.join(dbSnapshotsPath, "not-a-snapshot.txt"), "");
      expect(manager.list()).toEqual([
        "2024-01-01_00-00-00__alpha",
        "2025-06-15_12-00-00__beta",
      ]);
    });
  });
});
