// Route tests for hourly reports with a mocked Gmail layer (the real fixture RAR served from
// tests/fixtures) against the separate alarms_test database. Runs only when
// TEST_DATABASE_URL is set and the fixtures exist. Touches only site_master rows whose codes
// come from the fixture SiteMaster file, and removes them afterwards.
import ExcelJS from "exceljs";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../tests/fixtures");
const SITE_MASTER = path.join(FIXTURES, "SiteMaster_KafrElDawar.xlsx");
const hasFixtures =
  existsSync(SITE_MASTER) &&
  ["NSN Update_Output.rar", "NSN_Update_Output.rar"].some((n) => existsSync(path.join(FIXTURES, n)));

const session = vi.hoisted(() => ({
  current: null as null | { user: { role: string; id: string } },
}));
vi.mock("next-auth", async (orig) => ({
  ...(await orig<typeof import("next-auth")>()),
  getServerSession: async () => session.current,
}));

const as = (role: "VIEWER" | "OPERATOR" | "ADMIN") => (session.current = { user: { role, id: "1" } });

type Params = { gmailId: string; code: string };
type Handler = (req: Request, ctx: { params: Params }) => Promise<Response>;

describe.skipIf(!url || !hasFixtures)("hourly report routes", () => {
  let prisma: typeof import("@alarm/db").prisma;
  let listGET: Handler, processPOST: Handler, statusGET: Handler, rowsGET: Handler;
  let exportGET: Handler, diffGET: Handler, importPOST: Handler, siteGET: Handler, sitePUT: Handler;
  let hourlyCache: typeof import("@/lib/hourly").hourlyCache;
  let gmailId = "";
  let importedCodes: string[] = [];
  let seededNormalizations = false;

  const call = async (fn: Handler, p: string, init?: RequestInit, params: Record<string, string> = {}) => {
    const res = await fn(new Request(`http://localhost${p}`, init), { params: params as Params });
    const ct = res.headers.get("content-type") ?? "";
    return { status: res.status, res, body: ct.includes("json") ? await res.json() : null };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("@alarm/db"));
    const gmail = await import("@/lib/gmail");
    gmail.setHourlySource(gmail.createDirHourlySource(FIXTURES));
    ({ hourlyCache } = await import("@/lib/hourly"));
    ({ GET: listGET } = await import("./route"));
    ({ POST: processPOST } = await import("./[gmailId]/process/route"));
    ({ GET: statusGET } = await import("./[gmailId]/status/route"));
    ({ GET: rowsGET } = await import("./[gmailId]/rows/route"));
    ({ GET: exportGET } = await import("./[gmailId]/export/route"));
    ({ GET: diffGET } = await import("./diff/route"));
    ({ POST: importPOST } = await import("../site-master/import/route"));
    ({ GET: siteGET } = await import("../site-master/route"));
    ({ PUT: sitePUT } = await import("../site-master/[code]/route"));

    if ((await prisma.hourlyNormalization.count()) === 0) {
      const { DEFAULT_HOURLY_NORMALIZATIONS } = await import("@alarm/core");
      await prisma.hourlyNormalization.createMany({ data: DEFAULT_HOURLY_NORMALIZATIONS });
      seededNormalizations = true;
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    if (importedCodes.length) await prisma.siteMaster.deleteMany({ where: { code: { in: importedCodes } } });
    if (seededNormalizations) await prisma.hourlyNormalization.deleteMany();
    hourlyCache.clear();
    (await import("@/lib/gmail")).setHourlySource(undefined);
  });

  it("imports SiteMaster (admin only) with an upsert summary", async () => {
    const { readFile } = await import("node:fs/promises");
    const data = await readFile(SITE_MASTER);
    const body = () => {
      const fd = new FormData();
      fd.set("file", new File([new Uint8Array(data)], "SiteMaster_KafrElDawar.xlsx"));
      return fd;
    };

    as("OPERATOR");
    expect((await call(importPOST, "/api/site-master/import", { method: "POST", body: body() })).status).toBe(403);

    as("ADMIN");
    const { parseSiteMasterXlsx } = await import("@alarm/core/hourly");
    importedCodes = (await parseSiteMasterXlsx(data)).rows.map((r) => r.code);
    await prisma.siteMaster.deleteMany({ where: { code: { in: importedCodes } } });

    const first = await call(importPOST, "/api/site-master/import", { method: "POST", body: body() });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ inserted: 136, updated: 0 });
    expect(first.body.data.skipped).toHaveLength(2);

    const again = await call(importPOST, "/api/site-master/import", { method: "POST", body: body() });
    expect(again.body.data).toMatchObject({ inserted: 0, updated: 136 });

    const list = await call(siteGET, "/api/site-master?q=3273");
    expect(list.body.data).toEqual([expect.objectContaining({ code: "3273DE", office: "KAFR EL DAWAR" })]);
  });

  it("lists reports from the (mocked) Gmail label", async () => {
    as("VIEWER");
    const r = await call(listGET, "/api/hourly-reports");
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
    const report = r.body.data.find((x: { fileName: string }) => /NSN.Update_Output\.rar/.test(x.fileName));
    expect(report).toMatchObject({ status: "pending", fileSize: 538_041 });
    gmailId = report.gmailId;
  });

  it("viewers cannot process and cannot read an unprocessed report", async () => {
    as("VIEWER");
    expect((await call(processPOST, "/x", { method: "POST" }, { gmailId })).status).toBe(403);
    expect((await call(rowsGET, `/x`, undefined, { gmailId })).status).toBe(409);
  });

  it("process → 202 → status done", async () => {
    as("OPERATOR");
    const p = await call(processPOST, "/x", { method: "POST" }, { gmailId });
    expect(p.status).toBe(202);
    expect(p.body.data).toEqual({ status: "processing" });

    let status = "processing";
    let meta: Record<string, unknown> | undefined;
    for (let i = 0; i < 120 && status === "processing"; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const s = await call(statusGET, "/x", undefined, { gmailId });
      status = s.body.data.status;
      meta = s.body.data.meta;
    }
    expect(status).toBe("done");
    expect(meta).toMatchObject({
      rowCount: 856 + 1394 + 35,
      sheets: { "2G_Down": 529, "3G_Down": 434, "4G_Down": 438, "5G_Down": 2, Environmental: 1394, HW: 35 },
    });
    expect(meta!.unmatchedCodes).toBeGreaterThan(0);

    // already done → 200 without re-processing
    const again = await call(processPOST, "/x", { method: "POST" }, { gmailId });
    expect(again.status).toBe(200);
  });

  it("rows filtered by office and alarm return only matching rows", async () => {
    as("VIEWER"); // processed now → viewers can read
    const office = await call(rowsGET, `/x?office=KAFR%20EL%20DAWAR&limit=500`, undefined, { gmailId });
    expect(office.status).toBe(200);
    expect(office.body.meta.total).toBeGreaterThan(0);
    expect(office.body.data.every((r: { office: string }) => r.office === "KAFR EL DAWAR")).toBe(true);

    const all = await call(rowsGET, `/x?limit=500&page=1`, undefined, { gmailId });
    expect(all.body.meta.total).toBe(2285);
    expect(all.body.data).toHaveLength(500);

    const both = await call(
      rowsGET,
      `/x?office=KAFR%20EL%20DAWAR&alarm=MAIN%20POWER%20CUT%20OFF&limit=500&facets=1`,
      undefined,
      { gmailId },
    );
    expect(both.status).toBe(200);
    expect(both.body.data.length).toBe(both.body.meta.total);
    for (const r of both.body.data) {
      expect(r.office).toBe("KAFR EL DAWAR");
      expect(r.alarmName).toBe("MAIN POWER CUT OFF");
    }
    // the same filter by hand over the office rows
    const expected = office.body.data.filter((r: { alarmName: string }) => r.alarmName === "MAIN POWER CUT OFF");
    expect(both.body.meta.total).toBe(expected.length);
    expect(both.body.meta.facets.office.length).toBeGreaterThan(0);

    const bad = await call(rowsGET, `/x?category=NOPE`, undefined, { gmailId });
    expect(bad.status).toBe(400);
    const tooMany = await call(rowsGET, `/x?limit=501`, undefined, { gmailId });
    expect(tooMany.status).toBe(400);
  });

  it("export returns a valid xlsx with exactly the requested columns", async () => {
    as("VIEWER");
    const r = await call(
      exportGET,
      `/x?office=KAFR%20EL%20DAWAR&columns=code,office,alarmName,alarmTime`,
      undefined,
      { gmailId },
    );
    expect(r.status).toBe(200);
    expect(r.res.headers.get("content-type")).toContain("spreadsheetml");
    expect(r.res.headers.get("content-disposition")).toMatch(/hourly-alarms-.*\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await r.res.arrayBuffer());
    const ws = wb.worksheets[0]!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(["Site Code", "Office", "Alarm", "Alarm Time"]);
    expect(ws.rowCount).toBeGreaterThan(1);
    for (let i = 2; i <= ws.rowCount; i++) expect(ws.getRow(i).getCell(2).value).toBe("KAFR EL DAWAR");
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });

    const bad = await call(exportGET, `/x?columns=code,nope`, undefined, { gmailId });
    expect(bad.status).toBe(400);
  });

  it("diff of a report with itself is rejected; SiteMaster edit refreshes enrichment", async () => {
    as("VIEWER");
    expect((await call(diffGET, `/x?a=${gmailId}&b=${gmailId}`)).status).toBe(400);

    as("ADMIN");
    const put = await call(
      sitePUT,
      "/x",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteType: "rooftop" }) },
      { code: "3273DE" },
    );
    expect(put.status).toBe(200);
    expect(hourlyCache.size).toBe(0); // enrichment changed → cache dropped
    const rows = await call(rowsGET, `/x?q=3273DE&limit=500`, undefined, { gmailId });
    expect(rows.status).toBe(200); // re-processed transparently
    expect(rows.body.data.every((r: { siteType: string }) => r.siteType === "ROOFTOP")).toBe(true);
  });
});
