import { buildLocalMongoEnv, defineConfig } from "../src/index";

export const localMongoEnv = buildLocalMongoEnv({
  dbUrl: "DATABASE_URL",
  dbSource: "DB_SOURCE",
});

export default defineConfig({
  containerName: "mongodb-smoke",
  port: 27099,
  dbSnapshotsPath: "../.smoke/localDb",
  envLocalPath: "../.smoke/.env.local",
  envPath: "../.smoke/.env",
  envKeyMapper: localMongoEnv.envKeyMapper,
  enablePushToHosted: false,
  enableHostedDbDuplication: false,
});
