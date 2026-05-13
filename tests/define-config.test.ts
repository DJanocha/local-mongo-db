import path from "node:path";

import { describe, expect, it } from "vitest";

import { defineConfig, resolveConfig } from "../src/define-config";

const BASE_PATHS = {
  dbSnapshotsPath: "/tmp/localDb",
  envLocalPath: "/tmp/.env.local",
  envPath: "/tmp/.env",
};

const BASE_MAPPER = { dbUrl: "DATABASE_URL" } as const;

describe("defineConfig", () => {
  it("is an identity function", () => {
    const config = {
      ...BASE_PATHS,
      envKeyMapper: BASE_MAPPER,
    };
    expect(defineConfig(config)).toBe(config);
  });
});

describe("resolveConfig", () => {
  it("applies all defaults when only required fields are provided", () => {
    const resolved = resolveConfig({
      ...BASE_PATHS,
      envKeyMapper: BASE_MAPPER,
    });
    expect(resolved.containerName).toBe("mongodb");
    expect(resolved.port).toBe(27017);
    expect(resolved.version).toBe("6.0.13-ubi8");
    expect(resolved.hostedDbUrlEnvKey).toBe("DATABASE_URL");
    expect(resolved.enablePushToHosted).toBe(false);
    expect(resolved.enableHostedDbDuplication).toBe(false);
    expect(resolved.namespaceTransform).toBeUndefined();
  });

  it("preserves user overrides", () => {
    const resolved = resolveConfig({
      ...BASE_PATHS,
      containerName: "custom-mongo",
      port: 27011,
      version: "7.0.0-ubi9",
      hostedDbUrlEnvKey: "MONGO_URL",
      envKeyMapper: { dbUrl: "DB_URI" },
      enablePushToHosted: true,
      enableHostedDbDuplication: true,
      namespaceTransform: { from: "Source.*", to: "Target.*" },
    });
    expect(resolved.containerName).toBe("custom-mongo");
    expect(resolved.port).toBe(27011);
    expect(resolved.version).toBe("7.0.0-ubi9");
    expect(resolved.hostedDbUrlEnvKey).toBe("MONGO_URL");
    expect(resolved.enablePushToHosted).toBe(true);
    expect(resolved.enableHostedDbDuplication).toBe(true);
    expect(resolved.namespaceTransform).toEqual({
      from: "Source.*",
      to: "Target.*",
    });
  });

  describe("envKeyMapper normalization", () => {
    it("normalizes a string dbUrl into a single-element array", () => {
      const resolved = resolveConfig({
        ...BASE_PATHS,
        envKeyMapper: { dbUrl: "DATABASE_URL" },
      });
      expect(resolved.envKeyMapper.dbUrl).toEqual(["DATABASE_URL"]);
      expect(resolved.envKeyMapper.dbSource).toEqual([]);
    });

    it("preserves a dbUrl array", () => {
      const resolved = resolveConfig({
        ...BASE_PATHS,
        envKeyMapper: { dbUrl: ["DATABASE_URL", "MONGO_URI"] },
      });
      expect(resolved.envKeyMapper.dbUrl).toEqual([
        "DATABASE_URL",
        "MONGO_URI",
      ]);
    });

    it("accepts a dbSource entry", () => {
      const resolved = resolveConfig({
        ...BASE_PATHS,
        envKeyMapper: {
          dbUrl: "DATABASE_URL",
          dbSource: "NEXT_PUBLIC_DB_SOURCE",
        },
      });
      expect(resolved.envKeyMapper.dbSource).toEqual([
        "NEXT_PUBLIC_DB_SOURCE",
      ]);
    });

    it("throws when dbUrl is empty", () => {
      expect(() =>
        resolveConfig({
          ...BASE_PATHS,
          envKeyMapper: { dbUrl: [] },
        }),
      ).toThrow(/at least one env key/);
    });

    it("throws when an env key collides across canonical fields", () => {
      expect(() =>
        resolveConfig({
          ...BASE_PATHS,
          envKeyMapper: {
            dbUrl: "DATABASE_URL",
            dbSource: "DATABASE_URL",
          },
        }),
      ).toThrow(/appears more than once/);
    });
  });

  describe("resolveEnvVariables factory", () => {
    it("emits the local URI for every dbUrl key", () => {
      const resolved = resolveConfig({
        ...BASE_PATHS,
        envKeyMapper: { dbUrl: ["DATABASE_URL", "MONGO_URI"] },
      });
      const vars = resolved.resolveEnvVariables({ port: 27099 });
      expect(vars).toEqual([
        { envKey: "DATABASE_URL", value: "mongodb://localhost:27099" },
        { envKey: "MONGO_URI", value: "mongodb://localhost:27099" },
      ]);
    });

    it("emits `local` for every dbSource key", () => {
      const resolved = resolveConfig({
        ...BASE_PATHS,
        envKeyMapper: {
          dbUrl: "DATABASE_URL",
          dbSource: ["DB_SOURCE", "NEXT_PUBLIC_DB_SOURCE"],
        },
      });
      const vars = resolved.resolveEnvVariables({ port: 27017 });
      expect(vars).toEqual([
        { envKey: "DATABASE_URL", value: "mongodb://localhost:27017" },
        { envKey: "DB_SOURCE", value: "local" },
        { envKey: "NEXT_PUBLIC_DB_SOURCE", value: "local" },
      ]);
    });

    it("folds extraEnvVariables into the resolved list", () => {
      const resolved = resolveConfig({
        ...BASE_PATHS,
        envKeyMapper: { dbUrl: "DATABASE_URL" },
        extraEnvVariables: ({ port }) => [
          { envKey: "DEBUG_PORT", value: String(port) },
        ],
      });
      const vars = resolved.resolveEnvVariables({ port: 27099 });
      expect(vars).toEqual([
        { envKey: "DATABASE_URL", value: "mongodb://localhost:27099" },
        { envKey: "DEBUG_PORT", value: "27099" },
      ]);
    });
  });

  describe("path resolution", () => {
    it("leaves absolute paths untouched without a configFilePath", () => {
      const resolved = resolveConfig({
        ...BASE_PATHS,
        envKeyMapper: BASE_MAPPER,
      });
      expect(resolved.dbSnapshotsPath).toBe("/tmp/localDb");
      expect(resolved.envLocalPath).toBe("/tmp/.env.local");
      expect(resolved.envPath).toBe("/tmp/.env");
    });

    it("resolves relative paths against the config file's directory", () => {
      const configFilePath = "/proj/local-db/local-mongo-db.config.ts";
      const resolved = resolveConfig(
        {
          dbSnapshotsPath: "./snapshots",
          envLocalPath: "../.env.local",
          envPath: "../.env",
          envKeyMapper: BASE_MAPPER,
        },
        configFilePath,
      );
      expect(resolved.dbSnapshotsPath).toBe(
        path.resolve("/proj/local-db", "./snapshots"),
      );
      expect(resolved.envLocalPath).toBe(
        path.resolve("/proj/local-db", "../.env.local"),
      );
      expect(resolved.envPath).toBe(path.resolve("/proj/local-db", "../.env"));
    });

    it("leaves absolute paths untouched even when configFilePath is given", () => {
      const resolved = resolveConfig(
        { ...BASE_PATHS, envKeyMapper: BASE_MAPPER },
        "/proj/local-db/local-mongo-db.config.ts",
      );
      expect(resolved.dbSnapshotsPath).toBe("/tmp/localDb");
    });
  });
});
