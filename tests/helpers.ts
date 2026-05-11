import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";

import type { EnvVariable } from "../src/define-config";

/** User shape used by every data-flow test. */
export type User = {
  _id: string;
  age: number;
  name: string;
};

export const SAMPLE_USERS: User[] = [
  { _id: "alice", age: 28, name: "Alice" },
  { _id: "bob", age: 35, name: "Bob" },
  { _id: "carol", age: 42, name: "Carol" },
];

export const ALT_USERS: User[] = [
  { _id: "dan", age: 19, name: "Dan" },
  { _id: "eve", age: 55, name: "Eve" },
];

export type MMSHandle = {
  server: MongoMemoryServer;
  uri: string;
  port: number;
  stop: () => Promise<void>;
};

/**
 * Spawn a single MongoMemoryServer instance. Optionally pin the port —
 * useful when the manager's local URI is built as `mongodb://localhost:${port}`
 * and we need the MMS to bind to that exact port.
 */
export const startMMS = async (port?: number): Promise<MMSHandle> => {
  const server = await MongoMemoryServer.create(
    port ? { instance: { port } } : undefined,
  );
  const uri = server.getUri();
  const actualPort = new URL(uri).port;
  return {
    server,
    uri,
    port: parseInt(actualPort, 10),
    stop: () => server.stop(),
  };
};

/** Create a unique temp dir under the OS tmp prefix. */
export const createTempDir = (label: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `local-mongo-db-${label}-`));
  return dir;
};

export const cleanupTempDir = (dir: string): void => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** Write env vars to a file in `KEY=value\n` form (one per line). */
export const writeEnvFile = (
  filePath: string,
  vars: readonly EnvVariable[],
): void => {
  const lines = vars.map(({ envKey, value }) => `${envKey}=${value}`);
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
};

/** Insert users into `dbName.users` against the given mongo URI. */
export const seedUsers = async (
  uri: string,
  dbName: string,
  users: readonly User[],
): Promise<void> => {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const collection = client.db(dbName).collection<User>("users");
    if (users.length > 0) {
      await collection.insertMany([...users]);
    }
  } finally {
    await client.close();
  }
};

/** Read all users from `dbName.users`, sorted by `_id` for stable comparison. */
export const readUsers = async (
  uri: string,
  dbName: string,
): Promise<User[]> => {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const collection = client.db(dbName).collection<User>("users");
    const docs = await collection.find({}).sort({ _id: 1 }).toArray();
    return docs.map((d) => ({ _id: d._id, age: d.age, name: d.name }));
  } finally {
    await client.close();
  }
};

/** Drop a database against the given URI. Used between test steps. */
export const dropDatabase = async (
  uri: string,
  dbName: string,
): Promise<void> => {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    await client.db(dbName).dropDatabase();
  } finally {
    await client.close();
  }
};

/** List all non-system database names against the given URI. */
export const listDatabases = async (uri: string): Promise<string[]> => {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const result = await client.db().admin().listDatabases({ nameOnly: true });
    return result.databases
      .map((db) => db.name)
      .filter((n) => !["admin", "config", "local"].includes(n));
  } finally {
    await client.close();
  }
};
