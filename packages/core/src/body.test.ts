import { describe, expect, it } from "vitest";
import { parseBody } from "./body.js";
import { parseMessage, type HashAlarm } from "./parser.js";
import { body } from "./__fixtures__/body.js";

describe("parseBody", () => {
  it("extracts every field of a NEW ALARM body (cell device)", () => {
    expect(parseBody(body({}))).toEqual({
      kind: "NEW",
      alarmName: "WCDMA CELL OUT OF USE",
      startTime: "11-OCT-2026 21:02:49",
      neName: "RNC66",
      alarmNumber: "7771",
      site: "U_S_XX-TEST_3830DE",
      cellName: "A_XX-TEST_3_24313_S",
      device: "cell",
      consecNbr: "2291814",
    });
  });

  it("parses a CLEARENCE ALARM body without a cell (MRBTS device)", () => {
    const b = parseBody(body({ kind: "CLEARENCE", cell: null, consec: "2291619" }));
    expect(b).toMatchObject({
      kind: "CLEAR",
      cellName: null,
      device: "MRBTS",
      consecNbr: "2291619",
    });
  });

  it("returns null for non-alarm bodies and missing bodies", () => {
    expect(parseBody("Dears,\nKindly find the attached report.\nBest Regards")).toBeNull();
    expect(parseBody("")).toBeNull();
    expect(parseBody(null)).toBeNull();
  });
});

describe("parseMessage (subject + body)", () => {
  const SUBJ = "S_D_N_WCDMA CELL OUT OF USE on #U_S_XX-TEST_3830DE# at |11-OCT-2026 21:02:49 |";

  it("adds CONSEC_NBR / cell and puts the cell in the alarm key", () => {
    const r = parseMessage(SUBJ, body({}));
    expect(r.ok).toBe(true);
    const v = (r as { value: HashAlarm }).value;
    expect(v).toMatchObject({
      consecNbr: "2291814",
      cellName: "A_XX-TEST_3_24313_S",
      device: "cell",
      neName: "RNC66",
      alarmKey: "S_D_N_WCDMA CELL OUT OF USE||U_S_XX-TEST_3830DE||A_XX-TEST_3_24313_S",
    });
  });

  it("same subject, different cells → different keys", () => {
    const a = parseMessage(SUBJ, body({ cell: "A_XX-TEST_2_24312_S", consec: "1" }));
    const b = parseMessage(SUBJ, body({ cell: "A_XX-TEST_3_24313_S", consec: "2" }));
    expect(a.ok && b.ok && a.value.alarmKey !== b.value.alarmKey).toBe(true);
  });

  it("without a cell the key stays name||site", () => {
    const r = parseMessage(SUBJ, body({ cell: null }));
    expect(r.ok && r.value.alarmKey).toBe("S_D_N_WCDMA CELL OUT OF USE||U_S_XX-TEST_3830DE");
  });

  it("falls back to subject-only parsing when the body is missing or not an alarm", () => {
    const r = parseMessage(SUBJ, "hello");
    expect(r.ok && r.value.format === "HASH" && r.value.consecNbr).toBe(null);
  });
});
