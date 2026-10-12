// Integration tests: real Route Handlers against the compose Postgres.
// Runs only when TEST_DATABASE_URL is set. Inserts rows under site prefix ZZ-APITEST and
// deletes exactly those afterwards — real data is never touched.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const PREFIX = "ZZ-APITEST";

const session = vi.hoisted(() => ({
  current: null as null | { user: { role: string; id?: string } },
}));
vi.mock("next-auth", async (orig) => ({
  ...(await orig<typeof import("next-auth")>()),
  getServerSession: async () => session.current,
}));

type Prisma = typeof import("@alarm/db").prisma;

describe.skipIf(!url)("API integration", () => {
  let prisma: Prisma;
  let activeGET: (req: Request) => Promise<Response>;
  let summaryGET: (req: Request) => Promise<Response>;

  const get = async (fn: (r: Request) => Promise<Response>, path: string) => {
    const res = await fn(new Request(`http://localhost${path}`));
    return { status: res.status, body: await res.json() };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("@alarm/db"));
    ({ GET: activeGET } = await import("./alarms/active/route"));
    ({ GET: summaryGET } = await import("./stats/summary/route"));

    await prisma.alarm.deleteMany({ where: { site: { startsWith: PREFIX } } });
    const h = 3_600_000;
    const now = Date.now();
    const base = { status: "ACTIVE" as const, clearTime: null, durationMin: null, clearType: null };
    await prisma.alarm.createMany({
      data: [
        {
          ...base,
          alarmKey: `LINK FAILURE||${PREFIX}-A`,
          alarmName: "S_D_N_BTS O&M LINK FAILURE",
          site: `${PREFIX}-A`,
          category: "DOWN",
          alarmTime: new Date(now - 10 * h),
        },
        {
          ...base,
          alarmKey: `RECTIFIER||${PREFIX}-B`,
          alarmName: "S_D_N_RECTIFIER MAJOR ALARM",
          site: `${PREFIX}-B`,
          category: "POWER",
          alarmTime: new Date(now - 1 * h),
        },
        {
          alarmKey: `LINK FAILURE||${PREFIX}-C`,
          alarmName: "S_D_N_BTS O&M LINK FAILURE",
          site: `${PREFIX}-C`,
          category: "DOWN",
          alarmTime: new Date(now - 2 * h),
          status: "CLEARED",
          clearTime: new Date(now - 1.5 * h),
          durationMin: 30,
          clearType: "EMAIL",
        },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.alarm.deleteMany({ where: { site: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  describe("GET /api/alarms/active", () => {
    it("401 without a session", async () => {
      session.current = null;
      expect((await get(activeGET, "/api/alarms/active")).status).toBe(401);
    });

    it("lists only ACTIVE alarms, filtered by site, newest first, paginated", async () => {
      session.current = { user: { role: "VIEWER" } };
      const { status, body } = await get(activeGET, `/api/alarms/active?site=${PREFIX}`);
      expect(status).toBe(200);
      expect(body).toMatchObject({ total: 2, page: 1, pageSize: 50, pages: 1 });
      expect(body.items.map((a: { site: string }) => a.site)).toEqual([
        `${PREFIX}-B`,
        `${PREFIX}-A`,
      ]);
      expect(body.items[0]).toMatchObject({ category: "POWER", status: "ACTIVE", region: null });
    });

    it("filters by category and minHours", async () => {
      session.current = { user: { role: "VIEWER" } };
      const byCat = await get(activeGET, `/api/alarms/active?site=${PREFIX}&category=DOWN`);
      expect(byCat.body.items.map((a: { site: string }) => a.site)).toEqual([`${PREFIX}-A`]);
      const old = await get(activeGET, `/api/alarms/active?site=${PREFIX}&minHours=4`);
      expect(old.body.total).toBe(1);
      expect(old.body.items[0].site).toBe(`${PREFIX}-A`);
    });

    it("paginates", async () => {
      session.current = { user: { role: "VIEWER" } };
      const p2 = await get(activeGET, `/api/alarms/active?site=${PREFIX}&pageSize=1&page=2`);
      expect(p2.body).toMatchObject({ total: 2, pages: 2, page: 2 });
      expect(p2.body.items).toHaveLength(1);
    });

    it("400 on invalid query", async () => {
      session.current = { user: { role: "VIEWER" } };
      const r = await get(activeGET, "/api/alarms/active?category=FIRE&page=0");
      expect(r.status).toBe(400);
      expect(Object.keys(r.body.details)).toEqual(expect.arrayContaining(["category", "page"]));
    });
  });

  describe("hidden alarm types (display settings)", () => {
    afterAll(async () => {
      await prisma.systemStatus.updateMany({
        data: { displayFilter: { hiddenCategories: [], hiddenAlarmNames: [] } },
      });
    });

    it("hidden category and hidden names disappear from the active list", async () => {
      session.current = { user: { role: "VIEWER" } };
      await prisma.systemStatus.upsert({
        where: { id: 1 },
        update: { displayFilter: { hiddenCategories: ["POWER"], hiddenAlarmNames: [] } },
        create: { id: 1, displayFilter: { hiddenCategories: ["POWER"], hiddenAlarmNames: [] } },
      });
      const r1 = await get(activeGET, `/api/alarms/active?site=${PREFIX}`);
      expect(r1.body.items.map((a: { category: string }) => a.category)).toEqual(["DOWN"]);
      // Filtering by a hidden category cannot bring it back.
      const r2 = await get(activeGET, `/api/alarms/active?site=${PREFIX}&category=POWER`);
      expect(r2.body.total).toBe(0);

      await prisma.systemStatus.update({
        where: { id: 1 },
        data: {
          displayFilter: { hiddenCategories: [], hiddenAlarmNames: ["S_D_N_BTS O&M LINK FAILURE"] },
        },
      });
      const r3 = await get(activeGET, `/api/alarms/active?site=${PREFIX}`);
      expect(r3.body.items.map((a: { site: string }) => a.site)).toEqual([`${PREFIX}-B`]);
    });

    it("summary counts exclude hidden types", async () => {
      session.current = { user: { role: "VIEWER" } };
      await prisma.systemStatus.update({
        where: { id: 1 },
        data: {
          displayFilter: { hiddenCategories: ["DOWN", "POWER", "OTHER"], hiddenAlarmNames: [] },
        },
      });
      const { body } = await get(summaryGET, "/api/stats/summary");
      expect(body.active.total).toBe(0);
      await prisma.systemStatus.update({
        where: { id: 1 },
        data: { displayFilter: { hiddenCategories: [], hiddenAlarmNames: [] } },
      });
    });
  });

  describe("personal hidden types (My preferences)", () => {
    it("hide only for the user who chose them", async () => {
      const me = await prisma.user.create({
        data: {
          email: "zz-apitest-hider@local",
          passwordHash: "x",
          displayPrefs: { hiddenCategories: ["POWER"], hiddenAlarmNames: [] },
        },
      });
      try {
        session.current = { user: { role: "VIEWER", id: String(me.id) } };
        const mine = await get(activeGET, `/api/alarms/active?site=${PREFIX}`);
        expect(mine.body.items.map((a: { category: string }) => a.category)).toEqual(["DOWN"]);

        session.current = { user: { role: "VIEWER" } }; // someone else
        const theirs = await get(activeGET, `/api/alarms/active?site=${PREFIX}`);
        expect(theirs.body.total).toBe(2);
      } finally {
        await prisma.user.delete({ where: { id: me.id } });
      }
    });
  });

  describe("GET /api/stats/summary", () => {
    it("401 without a session", async () => {
      session.current = null;
      expect((await get(summaryGET, "/api/stats/summary")).status).toBe(401);
    });

    it("returns active counts, MTTR, overdue and last run", async () => {
      session.current = { user: { role: "VIEWER" } };
      const { status, body } = await get(summaryGET, "/api/stats/summary");
      expect(status).toBe(200);
      expect(body.active.DOWN).toBeGreaterThanOrEqual(1);
      expect(body.active.POWER).toBeGreaterThanOrEqual(1);
      expect(body.active.total).toBe(body.active.DOWN + body.active.POWER + body.active.OTHER);
      expect(body.overdue.alertHours).toBe(4);
      expect(body.overdue.count).toBeGreaterThanOrEqual(1); // the 10h-old test alarm
      expect(body.mttr.days).toBe(30);
      expect(body.mttr.byCategory.DOWN.count).toBeGreaterThanOrEqual(1);
      expect(typeof body.mttr.byCategory.DOWN.avgMin).toBe("number");
      expect(body.lastRun).toHaveProperty("ageSec");
      expect(body.lastRun).toHaveProperty("error");
    });
  });
});
