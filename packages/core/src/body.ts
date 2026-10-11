// Email-body parser. Confirmed from 200 real bodies (label dn-kafr-eldawar, 2026-10-11):
//
//   ############NEW ALARM###########        (Clear: ############CLEARENCE ALARM###########)
//   ALARM NAME:
//           WCDMA CELL OUT OF USE
//   ALARM_START_TIME:
//           11-OCT-2026 21:02:49
//   NE_name:            RNC66
//   Alarm_Number        7771            (no colon on this label)
//   ALARM_SITE:         U_S_BH-MHLT-KYL_3830DE
//   cell name :         A_BH-MHLT-KYL_3_24313_S     (only when ALARM_Device = cell)
//   ALARM_Device:       cell | MRBTS | site
//   CONSEC_NBR:         2291814             (unique per alarm; its Clear carries the same number)
//
// Each label is on its own line and its value on the next non-empty line.

export interface BodyFields {
  kind: "NEW" | "CLEAR" | null;
  alarmName: string | null;
  startTime: string | null;
  neName: string | null;
  alarmNumber: string | null;
  site: string | null;
  cellName: string | null;
  device: string | null;
  consecNbr: string | null;
}

const LABELS: Record<string, keyof BodyFields> = {
  "ALARM NAME": "alarmName",
  ALARM_START_TIME: "startTime",
  NE_NAME: "neName",
  ALARM_NUMBER: "alarmNumber",
  ALARM_SITE: "site",
  "CELL NAME": "cellName",
  ALARM_DEVICE: "device",
  CONSEC_NBR: "consecNbr",
};

/** Returns null when the body does not look like an alarm notification (no CONSEC_NBR). */
export function parseBody(body: string | null | undefined): BodyFields | null {
  if (!body) return null;
  const lines = body
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const out: BodyFields = {
    kind: null,
    alarmName: null,
    startTime: null,
    neName: null,
    alarmNumber: null,
    site: null,
    cellName: null,
    device: null,
    consecNbr: null,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const banner = /^#{3,}\s*(.+?)\s*#{3,}$/.exec(line);
    if (banner) {
      const b = banner[1]!.toUpperCase();
      out.kind = b.includes("CLEAR") ? "CLEAR" : b.includes("NEW") ? "NEW" : null;
      continue;
    }
    // "LABEL:" / "LABEL :" / "LABEL" (Alarm_Number has no colon) with the value on the next line.
    const m = /^([A-Za-z_ ]+?)\s*:?\s*$/.exec(line);
    const key = m ? LABELS[m[1]!.trim().toUpperCase()] : undefined;
    if (key && key !== "kind" && i + 1 < lines.length) {
      const value = lines[i + 1]!;
      // Guard: the "value" must not itself be another known label.
      if (!LABELS[value.replace(/\s*:?\s*$/, "").toUpperCase()]) {
        out[key] = value as never;
        i++;
      }
    }
  }

  if (!out.consecNbr || !/^\d+$/.test(out.consecNbr)) return null;
  return out;
}
