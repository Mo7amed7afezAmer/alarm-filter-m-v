// Creates a throwaway admin (random password, alarms_test only) and loads the fixture
// SiteMaster so the office filter has data — in a child node process (see e2e/db.mjs).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PASSWORD_FILE, testDbUrl } from "./shared";

export default async function globalSetup() {
  testDbUrl(); // fail fast with a clear message
  execFileSync(process.execPath, [path.join(__dirname, "db.mjs"), "setup", PASSWORD_FILE], {
    stdio: "inherit",
    env: process.env,
  });
}
