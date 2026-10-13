// Smoke: sign in → /hourly → process the fixture report → open → filter by office → export.
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { E2E_EMAIL, readPassword } from "./shared";

test("process, filter and export an hourly report", async ({ page }) => {
  await page.goto("/login?callbackUrl=%2Fhourly");
  await page.getByLabel(/email/i).fill(E2E_EMAIL);
  await page.getByLabel(/password/i).fill(readPassword());
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/hourly");

  const row = page.locator("tr[data-gmail-id]", { hasText: /NSN.Update_Output\.rar/ });
  await expect(row).toBeVisible();
  const process = row.getByRole("button", { name: /process|retry/i });
  if (await process.isVisible()) await process.click();
  await expect(row.getByText(/2,285 rows/)).toBeVisible({ timeout: 120_000 });

  await row.getByRole("link", { name: "Open" }).click();
  await expect(page.getByTestId("row-count")).toContainText("of 2,285 rows");

  // office filter → URL + rows
  await page.getByRole("button", { name: "Office" }).click();
  await page.getByRole("option", { name: /KAFR EL DAWAR/ }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/office=KAFR\+EL\+DAWAR/);
  const count = page.getByTestId("row-count");
  await expect(count).not.toContainText("Showing 2,285");
  const offices = await page.locator("[data-testid=hourly-table] tbody tr[data-office]").evaluateAll((trs) =>
    [...new Set(trs.map((t) => t.getAttribute("data-office")))],
  );
  expect(offices).toEqual(["KAFR EL DAWAR"]);

  // export downloads an xlsx with the same filter
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-excel").click()]);
  expect(download.suggestedFilename()).toMatch(/^hourly-alarms-.*\.xlsx$/);
  const file = await download.path();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file!);
  const ws = wb.worksheets[0]!;
  const header = (ws.getRow(1).values as unknown[]).slice(1);
  expect(header).toContain("Office");
  const officeCol = header.indexOf("Office") + 1;
  expect(ws.rowCount).toBeGreaterThan(1);
  for (let i = 2; i <= ws.rowCount; i++) expect(ws.getRow(i).getCell(officeCol).value).toBe("KAFR EL DAWAR");
});
