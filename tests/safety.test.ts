import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveConfig } from "../src/define-config";
import { LocalMongoManager } from "../src/manager";
import {
  cleanupTempDir,
  createTempDir,
  writeEnvFile,
} from "./helpers";

const makeManager = (params: {
  envPath: string;
  envLocalPath: string;
  dbSnapshotsPath: string;
  enablePushToHosted?: boolean;
}) =>
  new LocalMongoManager(
    resolveConfig({
      envPath: params.envPath,
      envLocalPath: params.envLocalPath,
      dbSnapshotsPath: params.dbSnapshotsPath,
      enablePushToHosted: params.enablePushToHosted,
      envKeyMapper: { dbUrl: "DATABASE_URL" },
    }),
    { registerSignalHandlers: false },
  );

describe("push safety gates", () => {
  let tmpDir: string;
  let envPath: string;
  let envLocalPath: string;
  let dbSnapshotsPath: string;

  beforeEach(() => {
    tmpDir = createTempDir("safety");
    envPath = path.join(tmpDir, ".env");
    envLocalPath = path.join(tmpDir, ".env.local");
    dbSnapshotsPath = path.join(tmpDir, "localDb");
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  describe("isPushBlocked", () => {
    it("blocks when enablePushToHosted: false AND target looks hosted", () => {
      writeEnvFile(envPath, [
        {
          envKey: "DATABASE_URL",
          value: "mongodb+srv://user:pw@cluster.mongodb.net/db",
        },
      ]);
      const manager = makeManager({
        envPath,
        envLocalPath,
        dbSnapshotsPath,
        enablePushToHosted: false,
      });
      const result = manager.isPushBlocked();
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain("PUSH TO HOSTED DATABASE IS BLOCKED");
    });

    it("does NOT block when enablePushToHosted: true (even with hosted target)", () => {
      writeEnvFile(envPath, [
        {
          envKey: "DATABASE_URL",
          value: "mongodb+srv://user:pw@cluster.mongodb.net/db",
        },
      ]);
      const manager = makeManager({
        envPath,
        envLocalPath,
        dbSnapshotsPath,
        enablePushToHosted: true,
      });
      expect(manager.isPushBlocked().blocked).toBe(false);
    });

    it("does NOT block when target is localhost (even with flag off)", () => {
      writeEnvFile(envPath, [
        { envKey: "DATABASE_URL", value: "mongodb://localhost:27017/db" },
      ]);
      const manager = makeManager({
        envPath,
        envLocalPath,
        dbSnapshotsPath,
        enablePushToHosted: false,
      });
      expect(manager.isPushBlocked().blocked).toBe(false);
    });

    it("does NOT block when target is 127.0.0.1 (even with flag off)", () => {
      writeEnvFile(envPath, [
        { envKey: "DATABASE_URL", value: "mongodb://127.0.0.1:27017/db" },
      ]);
      const manager = makeManager({
        envPath,
        envLocalPath,
        dbSnapshotsPath,
        enablePushToHosted: false,
      });
      expect(manager.isPushBlocked().blocked).toBe(false);
    });
  });

  describe("isTargetHosted", () => {
    it("returns true for mongodb+srv URIs", () => {
      writeEnvFile(envPath, [
        {
          envKey: "DATABASE_URL",
          value: "mongodb+srv://user:pw@cluster.mongodb.net/db",
        },
      ]);
      const manager = makeManager({ envPath, envLocalPath, dbSnapshotsPath });
      expect(manager.isTargetHosted()).toBe(true);
    });

    it("returns false for localhost", () => {
      writeEnvFile(envPath, [
        { envKey: "DATABASE_URL", value: "mongodb://localhost:27017/db" },
      ]);
      const manager = makeManager({ envPath, envLocalPath, dbSnapshotsPath });
      expect(manager.isTargetHosted()).toBe(false);
    });

    it("returns false for 127.0.0.1", () => {
      writeEnvFile(envPath, [
        { envKey: "DATABASE_URL", value: "mongodb://127.0.0.1:27017/db" },
      ]);
      const manager = makeManager({ envPath, envLocalPath, dbSnapshotsPath });
      expect(manager.isTargetHosted()).toBe(false);
    });
  });

  describe("masked connection string", () => {
    it("hides the password but keeps the host", () => {
      writeEnvFile(envPath, [
        {
          envKey: "DATABASE_URL",
          value: "mongodb+srv://user:supersecret@cluster.mongodb.net/db",
        },
      ]);
      const manager = makeManager({ envPath, envLocalPath, dbSnapshotsPath });
      const masked = manager.getMaskedConnectionString();
      expect(masked).toContain("cluster.mongodb.net");
      expect(masked).not.toContain("supersecret");
    });
  });
});
