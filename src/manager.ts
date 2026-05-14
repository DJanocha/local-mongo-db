import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { format } from "date-fns";
import { MongoClient } from "mongodb";

import type {
  EnvVariable,
  ResolvedLocalMongoConfig,
} from "./define-config";
import { appendEnvVars, readEnvKey, removeEnvKeys } from "./env-file";
import { delay } from "./utils/async";
import { colors } from "./utils/colors";
import { banner, log } from "./utils/log";
import { mightFailSync } from "./utils/sync";

const dbSaveSeparator = "__";
const dbSaveSavingFormat = "yyyy-MM-dd_HH-mm-ss";

const createSnapshotSlug = (name: string, date: Date = new Date()) => {
  const formattedDate = format(date, dbSaveSavingFormat);
  return `${formattedDate}${dbSaveSeparator}${name}`;
};

export type LocalMongoManagerOptions = {
  /**
   * When `false`, the manager does NOT install SIGINT/SIGTERM/SIGHUP/
   * uncaughtException/unhandledRejection handlers. Default `true`.
   * Tests pass `false` so the test runner's own signal handling stays clean.
   */
  registerSignalHandlers?: boolean;
};

export class LocalMongoManager {
  private readonly config: ResolvedLocalMongoConfig;
  private readonly dumpPath: string;
  private isCleanupRunning = false;
  private mongoProcess: ReturnType<typeof spawn> | null = null;
  private hostedAtlasUri: string | undefined = undefined;

  constructor(
    config: ResolvedLocalMongoConfig,
    options: LocalMongoManagerOptions = {},
  ) {
    this.config = config;

    if (!fs.existsSync(config.dbSnapshotsPath)) {
      fs.mkdirSync(config.dbSnapshotsPath, { recursive: true });
    }
    this.dumpPath = path.join(config.dbSnapshotsPath, "dump");
    if (!fs.existsSync(this.dumpPath)) {
      fs.mkdirSync(this.dumpPath, { recursive: true });
    }

    if (options.registerSignalHandlers !== false) {
      this.registerCleanupHandlers();
    }
  }

  private resolveEnvVariables(): readonly EnvVariable[] {
    return this.config.resolveEnvVariables({ port: this.config.port });
  }

  private registerCleanupHandlers() {
    let cleanupInProgress = false;

    const handleSignal = async (signal: string) => {
      if (cleanupInProgress) {
        log.step("Cleanup already in progress, waiting...");
        return;
      }
      cleanupInProgress = true;

      log.info(`\nReceived ${signal}, starting graceful shutdown...`);

      try {
        await this.cleanup();
        await delay(1000);
      } finally {
        process.exit(0);
      }
    };

    process.on("SIGINT", () => {
      void handleSignal("SIGINT");
    });
    process.on("SIGTERM", () => {
      void handleSignal("SIGTERM");
    });
    process.on("SIGHUP", () => {
      void handleSignal("SIGHUP");
    });
    process.on("uncaughtException", (error) => {
      log.error("\nUncaught Exception:", error);
      void handleSignal("UNCAUGHT_EXCEPTION");
    });
    process.on("unhandledRejection", (error) => {
      log.error("\nUnhandled Rejection:", error);
      void handleSignal("UNHANDLED_REJECTION");
    });
  }

  private isPodmanRunning(): boolean {
    try {
      const output = execSync("podman machine list").toString();
      return output.includes("Currently running");
    } catch {
      return false;
    }
  }

  private async waitForMongoDB(): Promise<void> {
    for (;;) {
      try {
        execSync(
          `podman exec ${this.config.containerName} mongosh --eval "db.runCommand('ping').ok"`,
        );
        return;
      } catch {
        await delay(1000);
      }
    }
  }

  private async ensureContainerStopped(): Promise<void> {
    if (this.mongoProcess) {
      try {
        process.kill(-this.mongoProcess.pid!, "SIGTERM");
        await delay(2000);
      } catch {
        // best-effort
      }
    }

    try {
      log.step("Checking for rootless-cni-infra container...");
      execSync(`podman container exists rootless-cni-infra`, {
        stdio: "ignore",
      });
      log.step("Removing rootless-cni-infra container...");
      execSync(`podman rm -f rootless-cni-infra`, { stdio: "ignore" });
      log.step("rootless-cni-infra container removed");
    } catch {
      // not present
    }

    try {
      execSync(`podman container exists ${this.config.containerName}`, {
        stdio: "ignore",
      });
      log.step("Existing MongoDB container found, removing it...");
      execSync(`podman rm -f ${this.config.containerName}`, {
        stdio: "ignore",
      });
      log.step("Container removed successfully");
    } catch {
      // not present
    }
  }

  private ensurePortFreed() {
    log.step("Ensuring port is freed...");
    const { port } = this.config;
    try {
      execSync(`lsof -i :${port}`, { stdio: "ignore" });
      log.warn(`Port ${port} is still in use, attempting to free it`);

      try {
        execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: "ignore" });
        log.step("Killed process using port");
      } catch {
        log.step("No process to kill");
      }

      try {
        execSync(`podman port rm ${port}`, { stdio: "inherit" });
        log.step("Port mapping removed");
      } catch {
        log.step("No podman port mapping found");
      }

      try {
        execSync(`lsof -i :${port}`, { stdio: "ignore" });
        log.warn(`Warning: Port ${port} is still in use after cleanup`);
      } catch {
        log.step(`Port ${port} is now free`);
      }
    } catch {
      log.step(`Port ${port} is already free`);
    }
  }

  private writeDbToBsonFile({ filePath }: { filePath: string }): boolean {
    log.step(`Writing database to BSON file: ${filePath}`);
    try {
      execSync(
        `mongodump --uri="mongodb://localhost:${this.config.port}" --archive="${filePath}" --quiet`,
        { stdio: "ignore" },
      );
      return true;
    } catch (error) {
      log.error(
        "Failed to write database to BSON file:",
        (error as Error).message,
      );
      return false;
    }
  }

  /** Gets the local database URI from the configured env file. */
  private getLocalDbUri(): string {
    const primaryLocalKey = this.config.envKeyMapper.dbUrl[0];
    if (primaryLocalKey) {
      const value = readEnvKey(this.config.envLocalPath, primaryLocalKey);
      if (value) return value;
    }
    return `mongodb://localhost:${this.config.port}`;
  }

  /** Gets the hosted Atlas URI from the configured env file. */
  private getHostedAtlasUri(): string {
    if (!fs.existsSync(this.config.envPath)) {
      throw new Error(`Environment file not found at ${this.config.envPath}`);
    }
    const value = readEnvKey(
      this.config.envPath,
      this.config.hostedDbUrlEnvKey,
    );
    if (!value) {
      throw new Error(
        `${this.config.hostedDbUrlEnvKey} not found in ${this.config.envPath}`,
      );
    }
    return value;
  }

  private nsArgs(): string {
    const ns = this.config.namespaceTransform;
    if (!ns) return "";
    return ` --nsFrom="${ns.from}" --nsTo="${ns.to}"`;
  }

  private loadDbFromBsonFile({ filePath }: { filePath: string }): boolean {
    try {
      execSync(
        `mongorestore --uri="mongodb://localhost:${this.config.port}" --archive="${filePath}" --drop${this.nsArgs()}`,
        { stdio: "inherit" },
      );
      return true;
    } catch (error) {
      log.error(
        "Failed to load database from BSON file:",
        (error as Error).message,
      );
      return false;
    }
  }

  private async cleanup() {
    if (this.isCleanupRunning) {
      log.step("Cleanup already in progress, skipping duplicate cleanup");
      return;
    }
    this.isCleanupRunning = true;

    if (fs.existsSync(this.config.envLocalPath)) {
      log.step("Removing local database configuration...");
      removeEnvKeys(
        this.config.envLocalPath,
        this.resolveEnvVariables().map((v) => v.envKey),
      );
      log.step("Local database configuration removed");
    }

    try {
      log.info("\nStarting cleanup process...");
      await this.ensureContainerStopped();
      this.ensurePortFreed();
      log.success("Cleanup completed successfully");
      log.success("Switched back to hosted database");
    } catch (error) {
      log.error("Error during cleanup:", (error as Error).message);
    } finally {
      this.isCleanupRunning = false;
      this.mongoProcess = null;
    }
  }

  async listHostedDatabases(): Promise<string[]> {
    try {
      const atlasUrl = this.getHostedAtlasUri();
      this.hostedAtlasUri = atlasUrl;

      const client = new MongoClient(this.hostedAtlasUri);
      await client.connect();

      const admin = client.db().admin();
      const result = await admin.listDatabases({ nameOnly: true });

      const databases = result.databases
        .map((db) => db.name)
        .filter((name) => !["admin", "config", "local"].includes(name));

      await client.close();
      return databases;
    } catch (error) {
      log.error("Error listing databases:", (error as Error).message);
      return [];
    }
  }

  async duplicateHostedDb(
    baseDbName: string,
    copiedDbName: string,
  ): Promise<boolean> {
    try {
      if (!fs.existsSync(this.config.envPath)) {
        throw new Error(
          `Environment file not found at ${this.config.envPath}`,
        );
      }
      if (!this.hostedAtlasUri) {
        this.hostedAtlasUri = this.getHostedAtlasUri();
      }

      const backupPath = path.join(this.dumpPath, "mongo-backup");
      if (!fs.existsSync(backupPath)) {
        fs.mkdirSync(backupPath, { recursive: true });
      }

      log.step(`Dumping database ${baseDbName}...`);
      execSync(
        `mongodump --uri="${this.hostedAtlasUri}" --db ${baseDbName} --out "${backupPath}"`,
      );

      log.step(`Restoring to new database ${copiedDbName}...`);
      execSync(
        `mongorestore --uri="${this.hostedAtlasUri}" --db ${copiedDbName} "${backupPath}/${baseDbName}" --drop${this.nsArgs()}`,
      );

      log.step("Cleaning up temporary files...");
      execSync(`rm -rf "${backupPath}"`);

      log.success(
        `Successfully duplicated ${baseDbName} to ${copiedDbName}!`,
      );
      return true;
    } catch (error) {
      log.error("Error:", (error as Error).message);
      return false;
    }
  }

  async shutdown() {
    await this.cleanup();
    await delay(1000);
    process.exit(0);
  }

  async start() {
    if (!this.isPodmanRunning()) {
      log.step("Starting podman machine...");
      execSync("podman machine start", { stdio: "ignore" });
    }

    await this.ensureContainerStopped();

    log.step(`Checking MongoDB image (version: ${this.config.version})...`);
    try {
      execSync(
        `podman image exists docker.io/mongodb/mongodb-community-server:${this.config.version}`,
        { stdio: "ignore" },
      );
      log.step("MongoDB image already exists locally");
    } catch {
      log.step("MongoDB image not found locally, pulling...");
      try {
        execSync(
          `podman pull docker.io/mongodb/mongodb-community-server:${this.config.version}`,
          { stdio: "ignore" },
        );
        log.step("MongoDB image pulled successfully");
      } catch (error) {
        log.error("Failed to pull MongoDB image:", error);
        process.exit(1);
      }
    }

    log.info("Starting MongoDB container...");
    this.mongoProcess = spawn(
      "podman",
      [
        "run",
        "--rm",
        "--name",
        this.config.containerName,
        "-p",
        `${this.config.port}:27017`,
        "-v",
        "mongodb_data:/data/db",
        "--stop-timeout",
        "30",
        "--init",
        `docker.io/mongodb/mongodb-community-server:${this.config.version}`,
        "mongod",
        "--quiet",
        "--logpath",
        "/dev/null",
        "--noauth",
        "--bind_ip_all",
        "--ipv6",
        "--nounixsocket",
        "--nojournal",
        "--setParameter",
        "diagnosticDataCollectionEnabled=false",
      ],
      {
        stdio: "ignore",
        detached: false,
      },
    );

    this.mongoProcess.on("error", () => {
      log.error("MongoDB container process error");
      void this.cleanup();
    });

    log.info("Waiting for MongoDB to be ready...");
    await this.waitForMongoDB();
    log.success("MongoDB is ready!");

    mightFailSync(() =>
      appendEnvVars(this.config.envLocalPath, this.resolveEnvVariables()),
    );

    banner(
      [
        "Local MongoDB is running!",
        `Connection string: mongodb://localhost:${this.config.port}`,
        "Use Ctrl+C to stop the database and switch back to the hosted DB",
      ],
      colors.green,
    );

    await new Promise<void>((resolve) =>
      this.mongoProcess!.on("close", (code) => {
        if (code !== 0) {
          log.warn("\nMongoDB container stopped");
        }
        void this.cleanup().then(() => resolve());
      }),
    );
  }

  pull(): boolean {
    try {
      const atlasUrl = this.getHostedAtlasUri();

      log.info(
        `Pulling data from hosted MongoDB connection string: ${this.maskConnectionString(atlasUrl)}...`,
      );
      execSync(`mongodump --uri=${atlasUrl} --out="${this.dumpPath}"`);
      execSync(
        `mongorestore --uri="mongodb://localhost:${this.config.port}" "${this.dumpPath}" --drop${this.nsArgs()}`,
      );
      log.success("Data pulled successfully!");

      log.step("Cleaning up temporary dump data...");
      execSync(`rm -rf "${this.dumpPath}"/*`);
      log.success("Cleanup complete!");
      return true;
    } catch (error) {
      log.error("Error:", (error as Error).message);
      return false;
    }
  }

  private maskConnectionString(uri: string): string {
    try {
      const url = new URL(uri);
      if (url.password) url.password = "****";
      return url.toString();
    } catch {
      return uri.replace(/:\/\/[^@]+@/, "://****@");
    }
  }

  push(source: "current" | (string & {})): boolean {
    try {
      const atlasUrl = this.getHostedAtlasUri();

      if (source === "current") {
        const localDbUri = this.getLocalDbUri();
        log.info("Pushing current local database state to hosted MongoDB...");
        log.step(
          `  Source (from ${path.basename(this.config.envLocalPath)}): ${this.maskConnectionString(localDbUri)}`,
        );
        log.step(
          `  Target (from ${path.basename(this.config.envPath)}): ${this.maskConnectionString(atlasUrl)}`,
        );

        const tempArchive = path.join(this.dumpPath, "_temp_push.bson");

        log.step("\nCreating temporary archive from local database...");
        execSync(
          `mongodump --uri="${localDbUri}" --archive="${tempArchive}" --quiet`,
          { stdio: "ignore" },
        );

        log.step("Restoring to hosted MongoDB...");
        execSync(
          `mongorestore --uri="${atlasUrl}" --archive="${tempArchive}" --drop`,
          { stdio: "inherit" },
        );

        fs.unlinkSync(tempArchive);

        log.success("Successfully pushed local database to hosted MongoDB!");
        return true;
      } else {
        const loadPath = path.join(
          this.config.dbSnapshotsPath,
          `${source}.bson`,
        );

        if (!fs.existsSync(loadPath)) {
          log.error(`Error: Snapshot "${source}" does not exist`);
          return false;
        }

        log.info(`Pushing snapshot "${source}" to hosted MongoDB...`);

        execSync(
          `mongorestore --uri="${atlasUrl}" --archive="${loadPath}" --drop`,
          { stdio: "inherit" },
        );

        log.success(
          `Successfully pushed snapshot "${source}" to hosted MongoDB!`,
        );
        return true;
      }
    } catch (error) {
      log.error(
        "Failed to push to hosted MongoDB:",
        (error as Error).message,
      );
      return false;
    }
  }

  getMaskedConnectionString(): string {
    return this.maskConnectionString(this.getHostedAtlasUri());
  }

  isTargetHosted(): boolean {
    const uri = this.getHostedAtlasUri();
    return !uri.includes("localhost") && !uri.includes("127.0.0.1");
  }

  isPushBlocked(): { blocked: boolean; reason?: string } {
    if (this.config.enablePushToHosted) {
      return { blocked: false };
    }

    if (this.isTargetHosted()) {
      return {
        blocked: true,
        reason: [
          "",
          colors.orange("═".repeat(70)),
          colors.orange("⛔ PUSH TO HOSTED DATABASE IS BLOCKED"),
          colors.orange("═".repeat(70)),
          "",
          colors.brightRed(
            "Pushing to hosted database is disabled in your config.",
          ),
          "",
          colors.yellow("To unlock this feature:"),
          `  Set ${colors.bold("enablePushToHosted: true")} in your ${colors.bold("defineConfig(...)")} call.`,
          "",
          colors.orange(
            "⚠️  IMPORTANT: think carefully before enabling — this can overwrite production data.",
          ),
          "",
          colors.orange("═".repeat(70)),
          "",
        ].join("\n"),
      };
    }

    return { blocked: false };
  }

  list(): string[] {
    const files = fs.readdirSync(this.config.dbSnapshotsPath);
    return files
      .filter((f) => f.endsWith(".bson"))
      .map((f) => f.replace(".bson", ""))
      .sort();
  }

  save(name: string): string | null {
    const slug = createSnapshotSlug(name);
    const savePath = path.join(
      this.config.dbSnapshotsPath,
      `${slug}.bson`,
    );

    log.info("Saving current database state...");
    if (this.writeDbToBsonFile({ filePath: savePath })) {
      log.success(`Snapshot saved: "${slug}"`);
      return slug;
    }
    return null;
  }

  load(slug: string): boolean {
    const loadPath = path.join(this.config.dbSnapshotsPath, `${slug}.bson`);

    if (!fs.existsSync(loadPath)) {
      log.error(`Error: Snapshot "${slug}" does not exist`);
      log.info("\nAvailable snapshots:");
      const available = this.list();
      if (available.length === 0) {
        log.step("  (none)");
      } else {
        available.forEach((s) => log.plain(`  - ${s}`));
      }
      return false;
    }

    log.info(`Loading snapshot: "${slug}"...`);
    if (this.loadDbFromBsonFile({ filePath: loadPath })) {
      log.success("Database state loaded successfully!");
      return true;
    }
    return false;
  }
}
