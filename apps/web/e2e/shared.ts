// Shared by global setup/teardown and the spec. Only ever touches alarms_test.
import { readFileSync } from "node:fs";
import path from "node:path";

export const E2E_EMAIL = "e2e-admin@local.test";
export const FIXTURES = path.resolve(__dirname, "../../../tests/fixtures");
export const SITE_MASTER = path.join(FIXTURES, "SiteMaster_KafrElDawar.xlsx");
/** Generated per run by global-setup (never a real password). */
export const PASSWORD_FILE = path.resolve(__dirname, "../.next-e2e/e2e-password");

export function testDbUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL (the alarms_test database) to run the e2e test");
  if (!/\/alarms_test(\?|$)/.test(url)) throw new Error("TEST_DATABASE_URL must point at alarms_test");
  return url;
}

export const readPassword = () => readFileSync(PASSWORD_FILE, "utf8").trim();
