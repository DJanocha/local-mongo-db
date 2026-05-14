import { execSync } from "node:child_process";

import { Command } from "commander";
import inquirer from "inquirer";
import { z } from "zod";

import {
  resolveConfig,
  type LocalMongoConfig,
  type ResolvedLocalMongoConfig,
} from "./define-config";
import { LocalMongoManager } from "./manager";
import { colors } from "./utils/colors";
import { log } from "./utils/log";

const loadActionSchema = z.object({ snapshot: z.string() });
const saveActionSchema = z.object({ saveName: z.string() });
const pushConfirmationSchema = z.object({ confirmation: z.string() });

type RootAction =
  | "start"
  | "pull"
  | "push"
  | "save"
  | "load"
  | "duplicate-hosted-db";

const buildRootActions = (
  config: ResolvedLocalMongoConfig,
): RootAction[] => {
  const actions: RootAction[] = ["start", "pull", "save", "load"];
  if (config.enablePushToHosted) actions.push("push");
  if (config.enableHostedDbDuplication) actions.push("duplicate-hosted-db");
  return actions;
};

const dangerBanner = (lines: string[]): void => {
  console.log("\n" + colors.orange("═".repeat(60)));
  console.log(colors.orange("⚠️  WARNING: DANGEROUS OPERATION ⚠️"));
  console.log(colors.orange("═".repeat(60)));
  for (const line of lines) console.log(line);
  console.log("\n" + colors.orange("═".repeat(60)));
};

async function rootPrompt(
  config: ResolvedLocalMongoConfig,
): Promise<RootAction> {
  const choices = buildRootActions(config);

  let isAlreadyRunning = false;
  try {
    execSync(`lsof -i :${config.port}`, { stdio: "ignore" });
    isAlreadyRunning = true;
  } catch {
    isAlreadyRunning = false;
  }

  const actionResult = await inquirer.prompt<{ action: RootAction }>([
    {
      type: "list",
      name: "action",
      message: "Choose an action:",
      choices: choices.map((choice) => {
        if (choice === "start" && isAlreadyRunning) {
          return {
            disabled: true,
            name: `${choice} (already running)`,
            value: choice,
          };
        }
        switch (choice) {
          case "load":
            return {
              name: `${choice} ${colors.gray("(from local snapshot)")}`,
              value: choice,
              disabled: false,
            };
          case "save":
            return {
              name: `${choice} ${colors.gray("(to local snapshot)")}`,
              value: choice,
              disabled: false,
            };
          case "pull":
            return {
              name: `${choice} ${colors.gray("(from hosted environment)")}`,
              value: choice,
              disabled: false,
            };
          case "push":
            return {
              name: colors.orange(
                `${choice} (⚠️ DANGEROUS: override hosted database)`,
              ),
              value: choice,
              disabled: false,
            };
          case "duplicate-hosted-db":
            return {
              name: `duplicate hosted db ${colors.gray("(create copy of hosted database)")}`,
              value: choice,
              disabled: false,
            };
          default:
            return { name: choice, value: choice, disabled: false };
        }
      }),
    },
  ]);

  // Sanity-check the chosen action is one we offered (defensive).
  if (!choices.includes(actionResult.action)) {
    throw new Error(`Unexpected action: ${actionResult.action}`);
  }
  return actionResult.action;
}

async function handleUserChoice(
  action: RootAction,
  manager: LocalMongoManager,
): Promise<void> {
  switch (action) {
    case "start":
      log.info("Starting with clean DB...");
      await manager.start();
      break;
    case "pull":
      log.info("Pulling from hosted environment...");
      manager.pull();
      break;
    case "push": {
      const blockCheck = manager.isPushBlocked();
      if (blockCheck.blocked) {
        console.log(blockCheck.reason);
        return;
      }

      const sourceResult = await inquirer.prompt<{
        pushSource: "current" | "snapshot";
      }>([
        {
          type: "list",
          name: "pushSource",
          message: colors.orange(
            "What do you want to push to hosted database?",
          ),
          choices: [
            { name: "Current local database state", value: "current" },
            { name: "A saved snapshot (.bson file)", value: "snapshot" },
          ],
        },
      ]);

      let snapshotToUse: string = "current";

      if (sourceResult.pushSource === "snapshot") {
        const savedFiles = manager.list();
        if (savedFiles.length === 0) {
          log.warn("No saved snapshots available.");
          return;
        }

        const { snapshot } = loadActionSchema.parse(
          await inquirer.prompt([
            {
              type: "list",
              name: "snapshot",
              message: colors.orange("Select a snapshot to push:"),
              choices: savedFiles,
            },
          ]),
        );
        snapshotToUse = snapshot;
      }

      const maskedUri = manager.getMaskedConnectionString();
      const sourceDisplay =
        snapshotToUse === "current"
          ? "current local database"
          : `snapshot "${snapshotToUse}"`;

      dangerBanner([
        colors.brightRed(`\nYou are about to OVERRIDE the hosted database!`),
        colors.yellow(`\n  Target: ${maskedUri}`),
        colors.yellow(`  Source: ${sourceDisplay}`),
        colors.brightRed(
          `\nThis will PERMANENTLY DELETE all data in the hosted database`,
        ),
        colors.brightRed(`and replace it with the ${sourceDisplay}.`),
      ]);

      const { confirmation } = pushConfirmationSchema.parse(
        await inquirer.prompt([
          {
            type: "input",
            name: "confirmation",
            message: colors.orange(
              "Type 'i am certain' to continue (or anything else to cancel):",
            ),
          },
        ]),
      );

      if (confirmation !== "i am certain") {
        log.warn("\nOperation cancelled. No changes were made.");
        return;
      }

      log.info("\nProceeding with push...\n");
      manager.push(snapshotToUse);
      break;
    }
    case "load": {
      const savedFiles = manager.list();
      if (savedFiles.length === 0) {
        log.warn("No saved snapshots available.");
        return;
      }
      const { snapshot } = loadActionSchema.parse(
        await inquirer.prompt([
          {
            type: "list",
            name: "snapshot",
            message: "Select a snapshot to load:",
            choices: savedFiles,
          },
        ]),
      );
      manager.load(snapshot);
      break;
    }
    case "save": {
      log.info("Saving current state...");
      const { saveName } = saveActionSchema.parse(
        await inquirer.prompt([
          {
            type: "input",
            name: "saveName",
            message: "Enter a name for the save or press enter to skip",
          },
        ]),
      );
      if (!saveName) {
        log.step("Skipping save...");
        return;
      }
      manager.save(saveName);
      break;
    }
    case "duplicate-hosted-db": {
      const databases = await manager.listHostedDatabases();
      if (databases.length === 0) {
        log.warn("No databases found or unable to list databases.");
        return;
      }
      const baseDbResult = await inquirer.prompt<{ baseDbName: string }>([
        {
          type: "list",
          name: "baseDbName",
          message: "Select the source database to duplicate:",
          choices: databases,
        },
      ]);
      const newDbResult = await inquirer.prompt<{ copiedDbName: string }>([
        {
          type: "input",
          name: "copiedDbName",
          message: "Enter the name for the new database:",
          validate: (input: string) =>
            !input || input.trim() === ""
              ? "Database name cannot be empty"
              : true,
        },
      ]);
      const copiedDbName = newDbResult.copiedDbName.trim();
      if (!copiedDbName) {
        log.warn("Operation cancelled - empty database name provided");
        process.exit(0);
      }
      await manager.duplicateHostedDb(baseDbResult.baseDbName, copiedDbName);
      break;
    }
  }
}

export function buildCli(
  config: LocalMongoConfig,
  configFilePath?: string,
): Command {
  const resolved = resolveConfig(config, configFilePath);
  const program = new Command();

  program
    .option("--list", "List all available snapshots")
    .option("--load-last", "Load the most recent DB snapshot")
    .option("--load <slug>", "Load a specific snapshot by slug")
    .option("--save-as <name>", "Save current database state with given name")
    .option("--start", "Start local MongoDB without interactive wizard")
    .option(
      "-p, --port <number>",
      `MongoDB port (default: ${resolved.port})`,
      String(resolved.port),
    );

  if (resolved.enablePushToHosted) {
    program
      .option(
        "--push <slug>",
        "⚠️ DANGEROUS: Push a snapshot to hosted DB (requires confirmation)",
      )
      .option(
        "--push-current",
        "⚠️ DANGEROUS: Push current local DB to hosted (requires confirmation)",
      );
  }

  program.action(async () => {
    const opts = program.opts() as {
      list?: boolean;
      loadLast?: boolean;
      load?: string;
      saveAs?: string;
      start?: boolean;
      push?: string;
      pushCurrent?: boolean;
      port: string;
    };

    const port = parseInt(opts.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      log.error(
        `Invalid port: ${opts.port}. Must be a number between 1 and 65535.`,
      );
      process.exit(1);
    }
    // Apply port override into resolved config so the manager picks it up.
    const finalConfig: ResolvedLocalMongoConfig = {
      ...resolved,
      port,
    };

    const manager = new LocalMongoManager(finalConfig);

    if (opts.list) {
      const snapshots = manager.list();
      if (snapshots.length === 0) {
        log.warn("No snapshots available.");
      } else {
        log.info("Available snapshots:");
        snapshots.forEach((s) => log.plain(`  ${s}`));
      }
      process.exit(0);
    }

    if (opts.start) {
      log.info("Starting local MongoDB...");
      await manager.start();
      return;
    }

    if (opts.saveAs) {
      const slug = manager.save(opts.saveAs);
      process.exit(slug ? 0 : 1);
    }

    if (opts.load) {
      const success = manager.load(opts.load);
      process.exit(success ? 0 : 1);
    }

    if (opts.loadLast) {
      const savedFiles = manager.list();
      if (savedFiles.length === 0) {
        log.warn(
          "No saved DB snapshots found. Please create a snapshot first.",
        );
        process.exit(1);
      }
      const latestSnapshot = savedFiles[savedFiles.length - 1];
      if (!latestSnapshot) {
        log.warn("No valid snapshot found to load.");
        process.exit(1);
      }
      const success = manager.load(latestSnapshot);
      process.exit(success ? 0 : 1);
    }

    if (opts.push || opts.pushCurrent) {
      const blockCheck = manager.isPushBlocked();
      if (blockCheck.blocked) {
        console.log(blockCheck.reason);
        process.exit(1);
      }
      const source: string = opts.pushCurrent ? "current" : opts.push!;
      const sourceDisplay =
        source === "current"
          ? "current local database"
          : `snapshot "${source}"`;
      const maskedUri = manager.getMaskedConnectionString();

      dangerBanner([
        colors.brightRed(`\nYou are about to OVERRIDE the hosted database!`),
        colors.yellow(`\n  Target: ${maskedUri}`),
        colors.yellow(`  Source: ${sourceDisplay}`),
        colors.brightRed(
          `\nThis will PERMANENTLY DELETE all data in the hosted database`,
        ),
        colors.brightRed(`and replace it with the ${sourceDisplay}.`),
      ]);

      const rl = await import("node:readline");
      const readline = rl.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await new Promise<string>((resolve) => {
        readline.question(
          colors.orange(
            "Type 'i am certain' to continue (or anything else to cancel): ",
          ),
          resolve,
        );
      });
      readline.close();

      if (answer !== "i am certain") {
        log.warn("\nOperation cancelled. No changes were made.");
        process.exit(0);
      }

      log.info("\nProceeding with push...\n");
      const success = manager.push(source);
      process.exit(success ? 0 : 1);
    }

    const action = await rootPrompt(finalConfig);
    await handleUserChoice(action, manager);
  });

  return program;
}
