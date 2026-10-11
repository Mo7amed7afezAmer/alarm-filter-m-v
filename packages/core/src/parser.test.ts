import { describe, expect, it } from "vitest";
import { parseSubject, type HashAlarm, type HuaweiAlarm } from "./parser.js";
import { parseAlarmStamp } from "./time.js";

// Shapes mirror samples/subjects.txt; site names are fictional.
function ok(subject: string, timeZone?: string) {
  const r = parseSubject(subject, { timeZone });
  if (!r.ok) throw new Error(`expected parse success, got: ${r.error}`);
  return r.value;
}

function fail(subject: string) {
  const r = parseSubject(subject);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.error;
}

describe("HASH format — alarm", () => {
  it("parses the CLAUDE.md §5 example", () => {
    const v = ok(
      "S_D_N_BTS O&M LINK FAILURE on #451_S_BH-KOM-AZIZA_0D36DE# at |08-OCT-2026 11:01:03 |",
    ) as HashAlarm;
    expect(v).toMatchObject({
      format: "HASH",
      isClear: false,
      alarmName: "S_D_N_BTS O&M LINK FAILURE",
      nameSuffix: null,
      site: "451_S_BH-KOM-AZIZA_0D36DE",
      alarmKey: "S_D_N_BTS O&M LINK FAILURE||451_S_BH-KOM-AZIZA_0D36DE",
    });
    // Africa/Cairo is UTC+3 (DST) on 8 Oct 2026.
    expect(v.alarmTime.toISOString()).toBe("2026-10-08T08:01:03.000Z");
  });

  it("parses the D_S_ prefix variant", () => {
    const v = ok("D_S_BCCH MISSING on #0001_O_XX-TEST-ONE_0A01DE# at |11-OCT-2026 16:40:06 |");
    expect(v.alarmName).toBe("D_S_BCCH MISSING");
    expect(v.site).toBe("0001_O_XX-TEST-ONE_0A01DE");
  });

  it("parses SRAN_* site ids that contain underscores", () => {
    const v = ok(
      "S_D_N_RECTIFIER MAJOR ALARM on #SRAN_LWG_TDNR_D_XX-TEST-TWO_0862DE# at |11-OCT-2026 16:40:52 |",
    );
    expect(v.site).toBe("SRAN_LWG_TDNR_D_XX-TEST-TWO_0862DE");
  });

  it("keeps vendor-truncated names as-is (alarm and Clear truncate identically)", () => {
    const a = ok(
      "S_D_N_SHELTER DOO on #SRAN_LWG_TDD_S_XX-TEST-3_3377DE# at |11-OCT-2026 15:46:24 |",
    );
    const c = ok(
      "CLEARED_S_D_N_SHELTER DOO on #SRAN_LWG_TDD_S_XX-TEST-3_3377DE# at |11-OCT-2026 15:46:24 |",
    );
    expect(a.alarmName).toBe("S_D_N_SHELTER DOO");
    expect(c.alarmKey).toBe(a.alarmKey);
  });

  it("splits a ';Default System Time' suffix out of the name and key", () => {
    const v = ok(
      "S_D_N_FIRE ALARM;Default System Time on #SRAN_LWG_TDD_G_XX-TEST-4_3458DE# at |11-OCT-2026 16:02:39 |",
    );
    expect(v.alarmName).toBe("S_D_N_FIRE ALARM");
    expect(v.nameSuffix).toBe("Default System Time");
    expect(v.alarmKey).toBe("S_D_N_FIRE ALARM||SRAN_LWG_TDD_G_XX-TEST-4_3458DE");
  });

  it("parses names with mixed case and hyphens", () => {
    const v = ok(
      "S_D_N_NE3S-WS Registration failed on #SRAN_LWG_D_XX-TEST-5_3230DE# at |24-SEP-2026 02:03:33 |",
    );
    expect(v.alarmName).toBe("S_D_N_NE3S-WS Registration failed");
  });

  it("tolerates extra whitespace and a missing space before the closing bar", () => {
    const v = ok("  S_D_N_FIRE ALARM  on #A1#  at |11-OCT-2026 16:08:25|  ");
    expect(v.alarmName).toBe("S_D_N_FIRE ALARM");
    expect(v.site).toBe("A1");
  });
});

describe("HASH format — Clear", () => {
  it("detects the CLEARED_ prefix and strips it from the name", () => {
    const v = ok(
      "CLEARED_S_D_N_BCCH MISSING on #0002_S_XX-TEST-SIX_3458DE# at |11-OCT-2026 16:00:30 |",
    );
    expect(v.isClear).toBe(true);
    expect(v.alarmName).toBe("S_D_N_BCCH MISSING");
  });

  it("produces the same key and time as the original alarm", () => {
    const subject =
      "S_D_N_FENCE GATE ALARM on #SRAN_LWG_TDD_J_XX-TEST-7_0732DE# at |11-OCT-2026 15:49:55 |";
    const a = ok(subject) as HashAlarm;
    const c = ok(`CLEARED_${subject}`) as HashAlarm;
    expect(c.alarmKey).toBe(a.alarmKey);
    expect(c.alarmTime.getTime()).toBe(a.alarmTime.getTime());
  });

  it("parses a Clear for an alarm weeks old (subject time is the original alarm time)", () => {
    const v = ok(
      "CLEARED_S_D_N_SHELTER HIGH TEMPRATURE on #SRAN_LWG_TDD_O_XX-TEST-8_0H33DE# at |31-AUG-2026 13:45:06 |",
    ) as HashAlarm;
    expect(v.isClear).toBe(true);
    expect(v.alarmTime.toISOString()).toBe("2026-08-31T10:45:06.000Z");
  });

  it("detects CLEARED_ case-insensitively", () => {
    expect(ok("cleared_S_D_N_FIRE ALARM on #A1# at |11-OCT-2026 16:08:25 |").isClear).toBe(true);
  });

  it("does not treat 'CLEAR' inside an alarm name as a Clear", () => {
    expect(ok("S_D_N_CLEAR CHANNEL FAULT on #A1# at |11-OCT-2026 16:08:25 |").isClear).toBe(false);
  });
});

describe("HUAWEI format", () => {
  it("parses NE / alarm / severity with no time", () => {
    const v = ok(
      "Huawei Alram Notify New alarm: TEST-RNC27/UMTS Cell Unavailable/Major",
    ) as HuaweiAlarm;
    expect(v).toEqual({
      format: "HUAWEI",
      isClear: false,
      alarmName: "UMTS Cell Unavailable",
      nameSuffix: null,
      site: "TEST-RNC27",
      severity: "Major",
      alarmTime: null,
      alarmKey: "UMTS Cell Unavailable||TEST-RNC27",
    });
  });

  it("parses Critical severity", () => {
    const v = ok(
      "Huawei Alram Notify New alarm: NEW-TESTBSC/Main Power Cut Off/Critical",
    ) as HuaweiAlarm;
    expect(v.severity).toBe("Critical");
    expect(v.alarmName).toBe("Main Power Cut Off");
  });
});

describe("unparseable subjects", () => {
  it("rejects an empty subject", () => {
    expect(fail("   ")).toBe("empty subject");
  });

  it("rejects an unrelated subject", () => {
    expect(fail("Weekly report — please review")).toBe("unrecognised subject format");
  });

  it("rejects a subject with no site markers", () => {
    expect(fail("S_D_N_FIRE ALARM at |11-OCT-2026 16:08:25 |")).toBe("unrecognised subject format");
  });

  it("rejects a malformed time", () => {
    expect(fail("S_D_N_FIRE ALARM on #A1# at |2026-10-11 16:08:25 |")).toMatch(/invalid time/);
  });

  it("rejects an impossible date", () => {
    expect(fail("S_D_N_FIRE ALARM on #A1# at |31-FEB-2026 16:08:25 |")).toMatch(/invalid time/);
  });

  it("rejects an unknown month", () => {
    expect(fail("S_D_N_FIRE ALARM on #A1# at |11-XYZ-2026 16:08:25 |")).toMatch(/invalid time/);
  });

  it("rejects an empty site", () => {
    expect(fail("S_D_N_FIRE ALARM on ## at |11-OCT-2026 16:08:25 |")).toBe(
      "unrecognised subject format",
    );
  });

  it("rejects a Huawei 'New alarm' with missing fields", () => {
    expect(fail("Huawei Alram Notify New alarm: ONLY-ONE-FIELD")).toBe(
      "unrecognised subject format",
    );
  });
});

describe("timezone handling", () => {
  it("uses Cairo summer time (UTC+3) in October 2026", () => {
    expect(parseAlarmStamp("11-OCT-2026 16:00:30", "Africa/Cairo")?.toISOString()).toBe(
      "2026-10-11T13:00:30.000Z",
    );
  });

  it("uses Cairo standard time (UTC+2) in winter", () => {
    expect(parseAlarmStamp("15-JAN-2026 10:00:00", "Africa/Cairo")?.toISOString()).toBe(
      "2026-01-15T08:00:00.000Z",
    );
  });

  it("honours an explicit timeZone option", () => {
    const v = ok("S_D_N_FIRE ALARM on #A1# at |11-OCT-2026 16:00:00 |", "UTC") as HashAlarm;
    expect(v.alarmTime.toISOString()).toBe("2026-10-11T16:00:00.000Z");
  });

  it("is case-insensitive on month names", () => {
    expect(parseAlarmStamp("11-oct-2026 16:00:30", "UTC")?.toISOString()).toBe(
      "2026-10-11T16:00:30.000Z",
    );
  });
});
