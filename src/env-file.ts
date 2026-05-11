import fs from "node:fs";
import _ from "lodash";

import type { EnvVariable } from "./define-config";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripQuotes = (raw: string): string => {
  let value = raw;
  if (value.startsWith(`"`) && value.endsWith(`"`)) value = value.slice(1, -1);
  if (value.startsWith(`'`) && value.endsWith(`'`)) value = value.slice(1, -1);
  return value;
};

/**
 * Read the (last-occurring, non-commented) value for `key` from a dotenv file.
 * Returns `undefined` if the file or key is missing. Matches the regex-based
 * lookup that lived inline in the original local-db scripts so behavior stays
 * identical: comments are skipped, trailing inline comments are NOT stripped,
 * and surrounding quote pairs are removed.
 */
export const readEnvKey = (filePath: string, key: string): string | undefined => {
  if (!fs.existsSync(filePath)) return undefined;

  const contents = fs.readFileSync(filePath, "utf-8");
  const pattern = new RegExp(`^${escapeRegex(key)}=(.+)$`);

  const matches = contents
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .map((line) => pattern.exec(line))
    .filter((match): match is RegExpExecArray => match !== null);

  const raw = _.last(matches)?.[1];
  if (!raw) return undefined;
  return stripQuotes(raw);
};

/**
 * Append the given env variables to `filePath`, creating the file if needed.
 * Mirrors the original "write line-by-line, joining with \n" behavior.
 */
export const appendEnvVars = (
  filePath: string,
  vars: readonly EnvVariable[],
): void => {
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf-8")
    : "";
  const existingLines = existing ? existing.split("\n") : [];
  const newLines = vars.map(({ envKey, value }) => `${envKey}=${value}`);
  fs.writeFileSync(filePath, [...existingLines, ...newLines].join("\n"));
};

/**
 * Strip any lines that start with one of `keys` (followed by `=`) from
 * `filePath`. Drops blank lines as well — matches the cleanup semantics in
 * the original script.
 */
export const removeEnvKeys = (
  filePath: string,
  keys: readonly string[],
): void => {
  if (!fs.existsSync(filePath)) return;

  const contents = fs.readFileSync(filePath, "utf-8");
  const updated = contents
    .split("\n")
    .filter((line) => line && !keys.some((key) => line.startsWith(`${key}=`)))
    .filter(Boolean)
    .join("\n");

  fs.writeFileSync(filePath, updated + "\n");
};
