// Smoke: sign in → /hourly → process the fixture report → open → filter by office → image → export.
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
  await expect(row.getByText(/2,285 rows/)).toBeVisible();

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

  // table as image (WhatsApp): PNG pages drawn from the filtered rows
  await page.getByTestId("table-image").click();
  const dialog = page.getByRole("dialog", { name: "Table as image" });
  const imgs = dialog.locator("img");
  await expect(imgs.first()).toBeVisible();
  const n = await imgs.count();
  const shown = Number((await count.locator("b").first().innerText()).replace(/,/g, ""));
  expect(n).toBeGreaterThanOrEqual(Math.ceil(shown / 40));
  // one set of images per category, never mixed
  const names = await dialog.locator("img").evaluateAll((els) => els.map((e) => e.getAttribute("alt")));
  for (const name of names) expect(name).toMatch(/-(down|power|other)(-\d+of\d+)?\.png$/);
  const size = await imgs.first().evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight]);
  expect(size[0]).toBeGreaterThan(800);
  expect(size[1]).toBeGreaterThan(200);
  const [png] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: /download/i }).click(),
  ]);
  expect(png.suggestedFilename()).toMatch(/^hourly-.*\.png$/);
  await dialog.getByRole("button", { name: "Close" }).click();

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
