import { describe, expect, it } from "vitest";

import { defineConfig, resolveConfig } from "../src/define-config";

const BASE_PATHS = {
  localDbPath: "/tmp/localDb",
  envLocalPath: "/tmp/.env.local",
  envPath: "/tmp/.env",
};

describe("defineConfig", () => {
  it("is an identity function", () => {
    const config = {
      ...BASE_PATHS,
      envVariables: [{ envKey: "DATABASE_URL", value: "x" }],
    } as const;
    expect(defineConfig(config)).toBe(config);
  });
});

describe("resolveConfig", () => {
  it("applies all defaults when only required fields are provided", () => {
    const resolved = resolveConfig({
      ...BASE_PATHS,
      envVariables: [],
    });
    expect(resolved.containerName).toBe("mongodb");
    expect(resolved.port).toBe(27017);
    expect(resolved.version).toBe("6.0.13-ubi8");
    expect(resolved.hostedConnectionEnvKey).toBe("DATABASE_URL");
    expect(resolved.localConnectionEnvKey).toBe("DATABASE_URL");
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
      hostedConnectionEnvKey: "MONGO_URL",
      localConnectionEnvKey: "DB_URI",
      enablePushToHosted: true,
      enableHostedDbDuplication: true,
      namespaceTransform: { from: "Source.*", to: "Target.*" },
      envVariables: [],
    });
    expect(resolved.containerName).toBe("custom-mongo");
    expect(resolved.port).toBe(27011);
    expect(resolved.version).toBe("7.0.0-ubi9");
    expect(resolved.hostedConnectionEnvKey).toBe("MONGO_URL");
    expect(resolved.localConnectionEnvKey).toBe("DB_URI");
    expect(resolved.enablePushToHosted).toBe(true);
    expect(resolved.enableHostedDbDuplication).toBe(true);
    expect(resolved.namespaceTransform).toEqual({
      from: "Source.*",
      to: "Target.*",
    });
  });

  it("normalizes a static envVariables array into a factory", () => {
    const resolved = resolveConfig({
      ...BASE_PATHS,
      envVariables: [
        { envKey: "DATABASE_URL", value: "mongodb://localhost:27017" },
        { envKey: "DB_SOURCE", value: "local" },
      ],
    });
    const result = resolved.envVariables({ port: 12345 });
    expect(result).toEqual([
      { envKey: "DATABASE_URL", value: "mongodb://localhost:27017" },
      { envKey: "DB_SOURCE", value: "local" },
    ]);
  });

  it("passes port through to a factory envVariables", () => {
    const resolved = resolveConfig({
      ...BASE_PATHS,
      envVariables: ({ port }) => [
        { envKey: "DATABASE_URL", value: `mongodb://localhost:${port}` },
      ],
    });
    expect(resolved.envVariables({ port: 27099 })).toEqual([
      {
        envKey: "DATABASE_URL",
        value: "mongodb://localhost:27099",
      },
    ]);
  });
});
