import { buildCli } from "./cli";
import type { LocalMongoConfig } from "./define-config";

/**
 * Programmatic entry point. Called from a tiny consumer script:
 *
 * ```ts
 * import { defineConfig, run } from "@danieljanocha/local-mongo-db";
 *
 * void run(defineConfig({
 *   localDbPath: "./localDb",
 *   envLocalPath: "./.env.local",
 *   envPath: "./.env",
 *   envVariables: ({ port }) => [
 *     { envKey: "DATABASE_URL", value: `mongodb://localhost:${port}` },
 *   ],
 * }));
 * ```
 */
export async function run<EnvKey extends string>(
  config: LocalMongoConfig<EnvKey>,
): Promise<void> {
  const program = buildCli(config);
  await program.parseAsync(process.argv);
}
