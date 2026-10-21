import { describe, expect, it } from "vitest";
import { labelNames, officeOfLabels } from "./gmail.js";

const names = new Map([
  ["INBOX", "INBOX"],
  ["Label_1", "DN/Kafr ElDawar"],
  ["Label_2", "DS/Benha"],
  ["Label_3", "Hourly Update"],
]);

describe("message labels", () => {
  it("maps label ids to names and drops noise labels", () => {
    expect(
      labelNames(["INBOX", "UNREAD", "IMPORTANT", "CATEGORY_UPDATES", "Label_1", "Label_9"], names),
    ).toEqual(["INBOX", "DN/Kafr ElDawar", "Label_9"]);
  });

  it("office = first label under an office parent; null for inbox-only mail", () => {
    const parents = ["DN", "DS"];
    expect(officeOfLabels(["INBOX", "DN/Kafr ElDawar"], parents)).toBe("DN/Kafr ElDawar");
    expect(officeOfLabels(["DS/Benha", "DN/Tanta"], parents)).toBe("DN/Tanta");
    expect(officeOfLabels(["dn/tanta"], parents)).toBe("dn/tanta");
    expect(officeOfLabels(["INBOX", "Hourly Update"], parents)).toBeNull();
    expect(officeOfLabels(["DNX/Other"], parents)).toBeNull();
  });
});
