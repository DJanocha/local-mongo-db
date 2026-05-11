import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendEnvVars,
  readEnvKey,
  removeEnvKeys,
} from "../src/env-file";
import { cleanupTempDir, createTempDir } from "./helpers";

describe("env-file", () => {
  let tmpDir: string;
  let envPath: string;

  beforeEach(() => {
    tmpDir = createTempDir("env-file");
    envPath = path.join(tmpDir, ".env");
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  describe("readEnvKey", () => {
    it("returns undefined when the file does not exist", () => {
      expect(readEnvKey(envPath, "DATABASE_URL")).toBeUndefined();
    });

    it("returns undefined when the key is not present", () => {
      fs.writeFileSync(envPath, "OTHER=value\n");
      expect(readEnvKey(envPath, "DATABASE_URL")).toBeUndefined();
    });

    it("reads a simple unquoted value", () => {
      fs.writeFileSync(envPath, "DATABASE_URL=mongodb://localhost:27017\n");
      expect(readEnvKey(envPath, "DATABASE_URL")).toBe(
        "mongodb://localhost:27017",
      );
    });

    it("strips surrounding double quotes", () => {
      fs.writeFileSync(envPath, `DATABASE_URL="mongodb://example.com"\n`);
      expect(readEnvKey(envPath, "DATABASE_URL")).toBe(
        "mongodb://example.com",
      );
    });

    it("strips surrounding single quotes", () => {
      fs.writeFileSync(envPath, `DATABASE_URL='mongodb://example.com'\n`);
      expect(readEnvKey(envPath, "DATABASE_URL")).toBe(
        "mongodb://example.com",
      );
    });

    it("skips commented lines", () => {
      fs.writeFileSync(
        envPath,
        ["# DATABASE_URL=ignored", "DATABASE_URL=real-value"].join("\n"),
      );
      expect(readEnvKey(envPath, "DATABASE_URL")).toBe("real-value");
    });

    it("returns the LAST non-commented match when duplicated", () => {
      fs.writeFileSync(
        envPath,
        ["DATABASE_URL=first", "DATABASE_URL=second"].join("\n"),
      );
      expect(readEnvKey(envPath, "DATABASE_URL")).toBe("second");
    });

    it("does not match keys that are prefixes of other keys", () => {
      fs.writeFileSync(envPath, "DB_NAME=foo\n");
      expect(readEnvKey(envPath, "DB")).toBeUndefined();
    });

    it("escapes regex-special characters in the key", () => {
      fs.writeFileSync(envPath, "WEIRD.KEY=value\n");
      expect(readEnvKey(envPath, "WEIRD.KEY")).toBe("value");
      // Plain "WEIRDXKEY" must NOT match — the dot is escaped, not wildcarded.
      expect(readEnvKey(envPath, "WEIRDXKEY")).toBeUndefined();
    });
  });

  describe("appendEnvVars", () => {
    it("creates the file when missing", () => {
      appendEnvVars(envPath, [
        { envKey: "DATABASE_URL", value: "mongodb://localhost:27017" },
        { envKey: "DB_SOURCE", value: "local" },
      ]);
      const contents = fs.readFileSync(envPath, "utf-8");
      expect(contents).toContain("DATABASE_URL=mongodb://localhost:27017");
      expect(contents).toContain("DB_SOURCE=local");
    });

    it("preserves existing contents when appending", () => {
      fs.writeFileSync(envPath, "API_KEY=secret\nOTHER=value");
      appendEnvVars(envPath, [
        { envKey: "DATABASE_URL", value: "mongodb://localhost:27017" },
      ]);
      const contents = fs.readFileSync(envPath, "utf-8");
      expect(contents).toContain("API_KEY=secret");
      expect(contents).toContain("OTHER=value");
      expect(contents).toContain("DATABASE_URL=mongodb://localhost:27017");
    });
  });

  describe("removeEnvKeys", () => {
    it("is a no-op when the file does not exist", () => {
      removeEnvKeys(envPath, ["DATABASE_URL"]);
      expect(fs.existsSync(envPath)).toBe(false);
    });

    it("strips matching lines but keeps the others", () => {
      fs.writeFileSync(
        envPath,
        [
          "API_KEY=secret",
          "DATABASE_URL=mongodb://localhost:27017",
          "DB_SOURCE=local",
          "OTHER=value",
        ].join("\n"),
      );
      removeEnvKeys(envPath, ["DATABASE_URL", "DB_SOURCE"]);
      const contents = fs.readFileSync(envPath, "utf-8");
      expect(contents).toContain("API_KEY=secret");
      expect(contents).toContain("OTHER=value");
      expect(contents).not.toContain("DATABASE_URL=");
      expect(contents).not.toContain("DB_SOURCE=");
    });

    it("drops blank lines that crept in", () => {
      fs.writeFileSync(
        envPath,
        ["API_KEY=secret", "", "DATABASE_URL=foo", ""].join("\n"),
      );
      removeEnvKeys(envPath, ["DATABASE_URL"]);
      const contents = fs.readFileSync(envPath, "utf-8");
      const lines = contents.split("\n").filter((l) => l.length > 0);
      expect(lines).toEqual(["API_KEY=secret"]);
    });

    it("does not strip lines whose key is a prefix of one we're removing", () => {
      // We're removing DATABASE_URL — DATABASE_URLISH must survive.
      fs.writeFileSync(
        envPath,
        ["DATABASE_URL=foo", "DATABASE_URLISH=bar"].join("\n"),
      );
      removeEnvKeys(envPath, ["DATABASE_URL"]);
      const contents = fs.readFileSync(envPath, "utf-8");
      expect(contents).not.toContain("DATABASE_URL=");
      expect(contents).toContain("DATABASE_URLISH=bar");
    });
  });
});
