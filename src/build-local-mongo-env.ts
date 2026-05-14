import { z } from "zod";

export type EnvKeyOrKeys = string | readonly string[];

export type BuildLocalMongoEnvInput = {
  /** Env key(s) that hold the local MongoDB connection string. */
  dbUrl: EnvKeyOrKeys;
  /** Optional env key(s) that hold the "local"/"hosted" label. */
  dbSource?: EnvKeyOrKeys;
};

export type LocalMongoEnvKeyMapper = {
  dbUrl: readonly string[];
  dbSource: readonly string[];
};

export type LocalMongoEnvSchema = Record<string, z.ZodTypeAny>;

export type BuildLocalMongoEnvResult = {
  /**
   * Flat Zod schema slice — spread into `createEnv({ server, client })`
   * wherever each key belongs.
   */
  schema: LocalMongoEnvSchema;
  /** Mapper passed to `defineConfig({ envKeyMapper })`. */
  envKeyMapper: LocalMongoEnvKeyMapper;
};

type KeyTuple<T extends EnvKeyOrKeys | undefined> = T extends string
  ? readonly [T]
  : T extends readonly string[]
    ? T
    : readonly [];

type KeyUnion<T extends EnvKeyOrKeys | undefined> = KeyTuple<T>[number];

export type BuildLocalMongoEnvResultFor<
  TDbUrl extends EnvKeyOrKeys,
  TDbSource extends EnvKeyOrKeys | undefined,
> = {
  /**
   * Flat Zod schema slice — spread into `createEnv({ server, client })`
   * wherever each key belongs.
   */
  schema: Record<KeyUnion<TDbUrl> | KeyUnion<TDbSource>, z.ZodTypeAny>;
  /** Mapper passed to `defineConfig({ envKeyMapper })`. */
  envKeyMapper: {
    dbUrl: KeyTuple<TDbUrl>;
    dbSource: KeyTuple<TDbSource>;
  };
};

const toArray = (value: EnvKeyOrKeys | undefined): string[] => {
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : [...value];
};

export const buildLocalMongoEnv = <
  const TDbUrl extends EnvKeyOrKeys,
  const TDbSource extends EnvKeyOrKeys | undefined = undefined,
>(
  input: { dbUrl: TDbUrl; dbSource?: TDbSource },
): BuildLocalMongoEnvResultFor<TDbUrl, TDbSource> => {
  const dbUrlKeys = toArray(input.dbUrl);
  const dbSourceKeys = toArray(input.dbSource);

  if (dbUrlKeys.length === 0) {
    throw new Error(
      "buildLocalMongoEnv: `dbUrl` must contain at least one env key.",
    );
  }

  const seen = new Map<string, "dbUrl" | "dbSource">();
  for (const key of dbUrlKeys) {
    if (seen.has(key)) {
      throw new Error(
        `buildLocalMongoEnv: env key "${key}" appears under multiple canonical fields.`,
      );
    }
    seen.set(key, "dbUrl");
  }
  for (const key of dbSourceKeys) {
    if (seen.has(key)) {
      throw new Error(
        `buildLocalMongoEnv: env key "${key}" appears under multiple canonical fields.`,
      );
    }
    seen.set(key, "dbSource");
  }

  const schema: LocalMongoEnvSchema = {};
  for (const key of dbUrlKeys) {
    schema[key] = z.string().url();
  }
  for (const key of dbSourceKeys) {
    schema[key] = z.enum(["local", "hosted"]).optional();
  }

  return {
    schema,
    envKeyMapper: {
      dbUrl: dbUrlKeys,
      dbSource: dbSourceKeys,
    },
  } as unknown as BuildLocalMongoEnvResultFor<TDbUrl, TDbSource>;
};
