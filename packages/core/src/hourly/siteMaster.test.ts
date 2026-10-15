import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseSiteMasterXlsx, phoneText } from "./siteMaster.js";
import { readFixture, SITE_MASTER_XLSX } from "./test-fixtures.js";
import { siteCodeOf } from "./types.js";

async function workbook(header: string[], ...rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("SiteMaster");
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("siteCodeOf (alarm-mail site → Site Master code)", () => {
  it.each([
    ["SRAN_LWG_TDD_S_BH-QMB-LOQIN_0H31DE", "0H31DE"],
    ["U_S_BH-MHLT-KYL_3830DE", "3830DE"],
    ["3111_S_KS-HAMRA-2_3705DE", "3705DE"],
    ["sran_lwg_s_ks-kom-hagr_3615de", "3615DE"],
  ])("%s → %s", (site, code) => expect(siteCodeOf(site)).toBe(code));
  it.each(["Hossary-RNC27", "", "SITE_WITHOUT_CODE"])("%j → null", (site) => expect(siteCodeOf(site)).toBeNull());
});

describe("phoneText", () => {
  it("restores the leading 0 Excel drops and keeps several numbers", () => {
    expect(phoneText("1012345678")).toBe("01012345678");
    expect(phoneText("01012345678")).toBe("01012345678");
    expect(phoneText("01012345678 / 01198765432")).toBe("01012345678 / 01198765432");
    expect(phoneText("01012345678 01198765432")).toBe("01012345678 / 01198765432");
    expect(phoneText("010 1234 5678")).toBe("01012345678");
    expect(phoneText("+20 10 1234 5678")).toBe("+201012345678");
  });
  it("returns null for empty / non-numbers", () => {
    expect(phoneText("")).toBeNull();
    expect(phoneText("n/a")).toBeNull();
  });
});

describe("parseSiteMasterXlsx phone column", () => {
  it("reads Guard Number (numeric cell) as the phone", async () => {
    const data = await workbook(
      ["Code", "Office", "VIP", "Battery", "Guard Number"],
      ["0001DE", "TANTA", "YES", "YES", 1012345678],
      ["0002DE", "TANTA", "NO", "NO", ""],
    );
    const { rows } = await parseSiteMasterXlsx(data);
    expect(rows.map((r) => [r.code, r.vip, r.battery, r.phone])).toEqual([
      ["0001DE", true, "YES", "01012345678"],
      ["0002DE", false, "NO", null],
    ]);
  });
  it("also accepts a Phone Number / Mobile header", async () => {
    for (const h of ["Phone Number", "Mobile", "phone"]) {
      const { rows } = await parseSiteMasterXlsx(await workbook(["Code", "Office", h], ["0001DE", "TANTA", "01198765432"]));
      expect(rows[0]!.phone).toBe("01198765432");
    }
  });
});

describe.skipIf(!SITE_MASTER_XLSX)("SiteMaster fixture phones", () => {
  it("reads the Guard Number column of the real template", async () => {
    const { rows } = await parseSiteMasterXlsx(readFixture(SITE_MASTER_XLSX));
    const phones = rows.filter((r) => r.phone);
    expect(phones.length).toBeGreaterThan(90);
    for (const r of phones) expect(r.phone).toMatch(/^(\+?\d{6,15})( \/ \+?\d{6,15})*$/);
  });
});
