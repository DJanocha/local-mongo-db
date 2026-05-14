import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildLocalMongoEnv } from "../src/build-local-mongo-env";

describe("buildLocalMongoEnv", () => {
  it("promotes a single string dbUrl into a single-element array", () => {
    const result = buildLocalMongoEnv({ dbUrl: "DATABASE_URL" });
    expect(result.envKeyMapper.dbUrl).toEqual(["DATABASE_URL"]);
    expect(result.envKeyMapper.dbSource).toEqual([]);
  });

  it("preserves a dbUrl array", () => {
    const result = buildLocalMongoEnv({
      dbUrl: ["DATABASE_URL", "MONGO_URI", "DB_URL"],
    });
    expect(result.envKeyMapper.dbUrl).toEqual([
      "DATABASE_URL",
      "MONGO_URI",
      "DB_URL",
    ]);
  });

  it("includes dbSource keys when provided", () => {
    const result = buildLocalMongoEnv({
      dbUrl: "DATABASE_URL",
      dbSource: ["DB_SOURCE", "NEXT_PUBLIC_DB_SOURCE"],
    });
    expect(result.envKeyMapper.dbSource).toEqual([
      "DB_SOURCE",
      "NEXT_PUBLIC_DB_SOURCE",
    ]);
  });

  it("produces a flat schema slice with url + enum schemas", () => {
    const result = buildLocalMongoEnv({
      dbUrl: "DATABASE_URL",
      dbSource: "DB_SOURCE",
    });
    expect(Object.keys(result.schema.shape).sort()).toEqual([
      "DATABASE_URL",
      "DB_SOURCE",
    ]);
    // dbUrl schema accepts a real URL, rejects garbage.
    const dbUrlSchema = result.schema.shape.DATABASE_URL as z.ZodTypeAny;
    expect(dbUrlSchema.safeParse("mongodb://localhost:27017").success).toBe(
      true,
    );
    expect(dbUrlSchema.safeParse("not-a-url").success).toBe(false);
    // dbSource schema accepts "local"/"hosted" and undefined.
    const dbSourceSchema = result.schema.shape.DB_SOURCE as z.ZodTypeAny;
    expect(dbSourceSchema.safeParse("local").success).toBe(true);
    expect(dbSourceSchema.safeParse("hosted").success).toBe(true);
    expect(dbSourceSchema.safeParse(undefined).success).toBe(true);
    expect(dbSourceSchema.safeParse("other").success).toBe(false);
  });

  it("throws when dbUrl is empty", () => {
    expect(() => buildLocalMongoEnv({ dbUrl: [] })).toThrow(
      /at least one env key/,
    );
  });

  it("throws when the same env key appears under multiple canonicals", () => {
    expect(() =>
      buildLocalMongoEnv({
        dbUrl: "DATABASE_URL",
        dbSource: "DATABASE_URL",
      }),
    ).toThrow(/appears under multiple/);
  });

  it("throws on duplicate keys within dbUrl", () => {
    expect(() =>
      buildLocalMongoEnv({ dbUrl: ["DATABASE_URL", "DATABASE_URL"] }),
    ).toThrow(/appears under multiple/);
  });
});
