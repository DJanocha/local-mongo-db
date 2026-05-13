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

const SOURCE_DB = "source-db";
const COPY_DB = "copy-db";
const OTHER_DB = "other-db";

describe("hosted-db duplication against mongo-memory-server", () => {
  let hosted: MMSHandle;

  beforeAll(async () => {
    hosted = await startMMS();
  });

  afterAll(async () => {
    await hosted.stop();
  });

  let tmpDir: string;
  let envPath: string;
  let envLocalPath: string;
  let dbSnapshotsPath: string;
  let manager: LocalMongoManager;

  beforeEach(() => {
    tmpDir = createTempDir("duplication");
    envPath = path.join(tmpDir, ".env");
    envLocalPath = path.join(tmpDir, ".env.local");
    dbSnapshotsPath = path.join(tmpDir, "localDb");

    writeEnvFile(envPath, [{ envKey: "DATABASE_URL", value: hosted.uri }]);

    manager = new LocalMongoManager(
      resolveConfig({
        envPath,
        envLocalPath,
        dbSnapshotsPath,
        port: 0, // unused — we never hit the local container path here
        enableHostedDbDuplication: true,
        envKeyMapper: { dbUrl: "DATABASE_URL" },
      }),
      { registerSignalHandlers: false },
    );
  });

  afterEach(async () => {
    await dropDatabase(hosted.uri, SOURCE_DB);
    await dropDatabase(hosted.uri, COPY_DB);
    await dropDatabase(hosted.uri, OTHER_DB);
    cleanupTempDir(tmpDir);
  });

  describe("listHostedDatabases", () => {
    it("lists user databases on the hosted MMS, filtering system DBs", async () => {
      await seedUsers(hosted.uri, SOURCE_DB, SAMPLE_USERS);
      await seedUsers(hosted.uri, OTHER_DB, SAMPLE_USERS);

      const names = await manager.listHostedDatabases();
      expect(names).toContain(SOURCE_DB);
      expect(names).toContain(OTHER_DB);
      // System dbs must be filtered out:
      expect(names).not.toContain("admin");
      expect(names).not.toContain("config");
      expect(names).not.toContain("local");
    });

    it("returns empty array when nothing user-owned exists", async () => {
      const names = await manager.listHostedDatabases();
      // Fresh MMS only has admin/config/local — all filtered out.
      expect(names).toEqual([]);
    });
  });

  describe("duplicateHostedDb", () => {
    it("creates a copy of the source database under a new name", async () => {
      await seedUsers(hosted.uri, SOURCE_DB, SAMPLE_USERS);

      // Prime the manager: listHostedDatabases() also stores the URI internally.
      await manager.listHostedDatabases();

      const ok = await manager.duplicateHostedDb(SOURCE_DB, COPY_DB);
      expect(ok).toBe(true);

      // Both databases now hold the same users.
      expect(await readUsers(hosted.uri, SOURCE_DB)).toEqual(SAMPLE_USERS);
      expect(await readUsers(hosted.uri, COPY_DB)).toEqual(SAMPLE_USERS);
    });

    it("source database is unchanged after duplication", async () => {
      await seedUsers(hosted.uri, SOURCE_DB, SAMPLE_USERS);
      await manager.listHostedDatabases();
      await manager.duplicateHostedDb(SOURCE_DB, COPY_DB);
      expect(await readUsers(hosted.uri, SOURCE_DB)).toEqual(SAMPLE_USERS);
    });
  });
});
