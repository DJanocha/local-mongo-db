/**
 * Visual preview of the CLI's colour palette and log levels.
 * Run with `pnpm preview` — pure stdout, no podman/mongo required.
 */
import { colors } from "./utils/colors";
import { banner, log } from "./utils/log";

console.log(colors.bold("\nPalette\n"));
for (const [name, paint] of Object.entries(colors)) {
  if (typeof paint !== "function") continue;
  console.log(`  ${paint(name.padEnd(10))} ${paint("The quick brown fox")}`);
}

console.log(colors.bold("\nLog levels\n"));
log.heading("heading — section title");
log.info("info — a headline action is starting");
log.step("step — low-signal sub-step detail");
log.success("success — an action finished");
log.warn("warn — something to notice");
log.error("error — an operation failed");
log.plain("plain — literal passthrough content");

banner(
  [
    "Local MongoDB is running!",
    "Connection string: mongodb://localhost:27011",
    "Use Ctrl+C to stop the database and switch back to the hosted DB",
  ],
  colors.green,
);

console.log(
  [
    colors.orange("═".repeat(60)),
    colors.orange("⚠️  WARNING: DANGEROUS OPERATION ⚠️"),
    colors.orange("═".repeat(60)),
    colors.brightRed("\nYou are about to OVERRIDE the hosted database!"),
    colors.yellow("\n  Target: mongodb+srv://****@cluster.example.net"),
    colors.yellow("  Source: current local database"),
    colors.orange("═".repeat(60)) + "\n",
  ].join("\n"),
);
