import fs from "node:fs";
import path from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { resolveConfig } from "../src/define-config";
import { LocalMongoManager } from "../src/manager";
import {
  ALT_USERS,
  SAMPLE_USERS,
  cleanupTempDir,
  createTempDir,
  dropDatabase,
  readUsers,
  seedUsers,
  startMMS,
  writeEnvFile,
  type MMSHandle,
} from "./helpers";

const DB_NAME = "testdb";

describe("data-flow against mongo-memory-server", () => {
  let hosted: MMSHandle;
  let local: MMSHandle;

  beforeAll(async () => {
    // Two MMS instances: one stands in for the hosted Atlas, the other for
    // the local podman container that `mongodb://localhost:${port}` points at.
    hosted = await startMMS();
    local = await startMMS();
  });

  afterAll(async () => {
    await hosted.stop();
    await local.stop();
  });

  let tmpDir: string;
  let envPath: string;
  let envLocalPath: string;
  let dbSnapshotsPath: string;
  let manager: LocalMongoManager;

  beforeEach(async () => {
    tmpDir = createTempDir("data-flow");
    envPath = path.join(tmpDir, ".env");
    envLocalPath = path.join(tmpDir, ".env.local");
    dbSnapshotsPath = path.join(tmpDir, "localDb");

    // Hosted env file points at hosted MMS.
    writeEnvFile(envPath, [{ envKey: "DATABASE_URL", value: hosted.uri }]);

    // Local env file points at local MMS — used by push() to read the source.
    writeEnvFile(envLocalPath, [
      { envKey: "DATABASE_URL", value: local.uri },
    ]);

    manager = new LocalMongoManager(
      resolveConfig({
        envPath,
        envLocalPath,
        dbSnapshotsPath,
        port: local.port, // matches `mongodb://localhost:${port}` in the manager
        enablePushToHosted: true,
        envKeyMapper: { dbUrl: "DATABASE_URL" },
      }),
      { registerSignalHandlers: false },
    );
  });

  afterEach(async () => {
    // Reset both MMS databases between tests so they don't bleed state.
    await dropDatabase(hosted.uri, DB_NAME);
    await dropDatabase(local.uri, DB_NAME);
    cleanupTempDir(tmpDir);
  });

  describe("save → load round-trip", () => {
    it("saves the current local DB to a .bson file and reloads it", async () => {
      await seedUsers(local.uri, DB_NAME, SAMPLE_USERS);

      const slug = manager.save("snap-one");
      expect(slug).not.toBeNull();
      const bsonFile = path.join(dbSnapshotsPath, `${slug}.bson`);
      expect(fs.existsSync(bsonFile)).toBe(true);

      // Wipe local DB, then reload from the snapshot.
      await dropDatabase(local.uri, DB_NAME);
      expect(await readUsers(local.uri, DB_NAME)).toEqual([]);

      const loaded = manager.load(slug!);
      expect(loaded).toBe(true);
      expect(await readUsers(local.uri, DB_NAME)).toEqual(SAMPLE_USERS);
    });

    it("list() returns saved snapshot slugs sorted chronologically", () => {
      manager.save("first");
      manager.save("second");
      const slugs = manager.list();
      expect(slugs).toHaveLength(2);
      expect(slugs[0]!.endsWith("__first")).toBe(true);
      expect(slugs[1]!.endsWith("__second")).toBe(true);
    });

    it("load() returns false for a non-existent snapshot", () => {
      expect(manager.load("does-not-exist")).toBe(false);
    });
  });

  describe("pull", () => {
    it("copies data from hosted MMS into local MMS", async () => {
      await seedUsers(hosted.uri, DB_NAME, SAMPLE_USERS);
      expect(await readUsers(local.uri, DB_NAME)).toEqual([]);

      const ok = manager.pull();
      expect(ok).toBe(true);
      expect(await readUsers(local.uri, DB_NAME)).toEqual(SAMPLE_USERS);
    });

    it("does NOT mutate the hosted DB during a pull", async () => {
      await seedUsers(hosted.uri, DB_NAME, SAMPLE_USERS);
      manager.pull();
      // Hosted DB should still hold exactly what we seeded.
      expect(await readUsers(hosted.uri, DB_NAME)).toEqual(SAMPLE_USERS);
    });
  });

  describe("push", () => {
    it("pushes current local DB to hosted MMS (replaces hosted)", async () => {
      await seedUsers(hosted.uri, DB_NAME, ALT_USERS);
      await seedUsers(local.uri, DB_NAME, SAMPLE_USERS);

      const ok = manager.push("current");
      expect(ok).toBe(true);
      // Hosted now has what local had; local is untouched.
      expect(await readUsers(hosted.uri, DB_NAME)).toEqual(SAMPLE_USERS);
      expect(await readUsers(local.uri, DB_NAME)).toEqual(SAMPLE_USERS);
    });

    it("pushes a named snapshot to hosted MMS", async () => {
      await seedUsers(local.uri, DB_NAME, SAMPLE_USERS);
      const slug = manager.save("for-push")!;

      // Local DB then gets wiped/replaced. The snapshot is what we push.
      await dropDatabase(local.uri, DB_NAME);
      await seedUsers(local.uri, DB_NAME, ALT_USERS);

      const ok = manager.push(slug);
      expect(ok).toBe(true);
      // Hosted matches the snapshot (SAMPLE_USERS), NOT the current local state.
      expect(await readUsers(hosted.uri, DB_NAME)).toEqual(SAMPLE_USERS);
      // Local state is still ALT_USERS — push from snapshot must not touch local.
      expect(await readUsers(local.uri, DB_NAME)).toEqual(ALT_USERS);
    });

    it("returns false when the snapshot does not exist", () => {
      const ok = manager.push("nonexistent-snapshot");
      expect(ok).toBe(false);
    });
  });

  describe("push safety gate (integration)", () => {
    it("isPushBlocked still works when enablePushToHosted: false + hosted target", async () => {
      // The hosted MMS URI is mongodb://localhost:PORT — explicitly NOT
      // hosted-looking. So we override the env to a real-looking Atlas URI
      // and re-construct the manager with the gate off.
      writeEnvFile(envPath, [
        {
          envKey: "DATABASE_URL",
          value: "mongodb+srv://user:pw@cluster.mongodb.net/db",
        },
      ]);
      const lockedManager = new LocalMongoManager(
        resolveConfig({
          envPath,
          envLocalPath,
          dbSnapshotsPath,
          port: local.port,
          enablePushToHosted: false,
          envKeyMapper: { dbUrl: "DATABASE_URL" },
        }),
        { registerSignalHandlers: false },
      );
      const result = lockedManager.isPushBlocked();
      expect(result.blocked).toBe(true);
    });
  });
});
