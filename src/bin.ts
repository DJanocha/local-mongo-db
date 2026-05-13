#!/usr/bin/env node
import { buildCli } from "./cli";
import { loadConfig } from "./load-config";

type ParsedConfigArg = {
  configPath: string | undefined;
  rest: string[];
};

const parseConfigArg = (argv: string[]): ParsedConfigArg => {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("`--config` requires a path argument.");
      }
      return {
        configPath: value,
        rest: [...argv.slice(0, i), ...argv.slice(i + 2)],
      };
    }
    if (arg && arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (!value) {
        throw new Error("`--config=` requires a path value.");
      }
      return {
        configPath: value,
        rest: [...argv.slice(0, i), ...argv.slice(i + 1)],
      };
    }
  }
  return { configPath: undefined, rest: argv };
};

const main = async (): Promise<void> => {
  const [, , ...userArgs] = process.argv;
  const { configPath, rest } = parseConfigArg(userArgs);
  const { config, configFilePath } = await loadConfig({ configPath });
  const program = buildCli(config, configFilePath);
  await program.parseAsync([
    process.argv[0]!,
    process.argv[1]!,
    ...rest,
  ]);
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
