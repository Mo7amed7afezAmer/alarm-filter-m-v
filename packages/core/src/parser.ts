// Subject-line parser. Shapes confirmed from samples/subjects.txt — see CLAUDE.md §5.
import { parseBody } from "./body.js";
import { parseAlarmStamp } from "./time.js";

export const DEFAULT_ALARM_TZ = "Africa/Cairo";

/** `NAME on #SITE# at |DD-MON-YYYY HH:mm:ss |`, optionally prefixed with `CLEARED_`. */
export interface HashAlarm {
  format: "HASH";
  isClear: boolean;
  /** Text before ` on #`, without `CLEARED_` and without any `;…` suffix. */
  alarmName: string;
  /** Text after `;` in the name (e.g. "Default System Time"), if any. Not part of the key. */
  nameSuffix: string | null;
  site: string;
  /** Subject time as UTC. For a Clear this is the ORIGINAL alarm's time, not the clear time. */
  alarmTime: Date;
  /** `${alarmName}||${site}`, plus `||${cellName}` when the body names a cell. */
  alarmKey: string;
  /** From the email body (null when there is no parseable body). */
  consecNbr: string | null;
  cellName: string | null;
  device: string | null;
  neName: string | null;
}

/** `Huawei Alram Notify New alarm: NE/ALARM/SEVERITY` — carries no time and no Clear form yet. */
export interface HuaweiAlarm {
  format: "HUAWEI";
  isClear: false;
  alarmName: string;
  nameSuffix: null;
  /** Network element (RNC/BSC name), the closest thing to a site in this format. */
  site: string;
  severity: string;
  alarmTime: null;
  alarmKey: string;
}

export type ParsedSubject = HashAlarm | HuaweiAlarm;

export type ParseResult = { ok: true; value: ParsedSubject } | { ok: false; error: string };

export interface ParseOptions {
  /** IANA zone the subject times are written in. Defaults to Africa/Cairo. */
  timeZone?: string;
}

const HASH_RE = /^(?<clear>CLEARED_)?(?<name>.+?) on #(?<site>[^#]+)# at \|(?<time>[^|]*)\|\s*$/i;
const HUAWEI_RE = /^Huawei Alram Notify New alarm:\s*(?<ne>[^/]+)\/(?<name>.+)\/(?<sev>[^/]+)$/i;

export function makeAlarmKey(alarmName: string, site: string, cellName?: string | null): string {
  return cellName ? `${alarmName}||${site}||${cellName}` : `${alarmName}||${site}`;
}

/** Subject + body. Body fields (CONSEC_NBR, cell name, …) refine HASH alarms; the subject
 *  stays authoritative for name, site, time and Clear detection. */
export function parseMessage(
  subject: string,
  body: string | null | undefined,
  opts: ParseOptions = {},
): ParseResult {
  const r = parseSubject(subject, opts);
  if (!r.ok || r.value.format !== "HASH") return r;
  const b = parseBody(body);
  if (!b) return r;
  const v = r.value;
  return {
    ok: true,
    value: {
      ...v,
      consecNbr: b.consecNbr,
      cellName: b.cellName,
      device: b.device,
      neName: b.neName,
      alarmKey: makeAlarmKey(v.alarmName, v.site, b.cellName),
    },
  };
}

export function parseSubject(subject: string, opts: ParseOptions = {}): ParseResult {
  const timeZone = opts.timeZone ?? DEFAULT_ALARM_TZ;
  const text = subject.replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, error: "empty subject" };

  const hash = HASH_RE.exec(text);
  if (hash?.groups) {
    const g = hash.groups as { clear?: string; name: string; site: string; time: string };
    const [rawName, ...rest] = g.name.split(";");
    const alarmName = rawName!.trim();
    const site = g.site.trim();
    if (!alarmName) return { ok: false, error: "empty alarm name" };
    if (!site) return { ok: false, error: "empty site" };
    const alarmTime = parseAlarmStamp(g.time, timeZone);
    if (!alarmTime) return { ok: false, error: `invalid time "${g.time.trim()}"` };
    return {
      ok: true,
      value: {
        format: "HASH",
        isClear: Boolean(g.clear),
        alarmName,
        nameSuffix: rest.length ? rest.join(";").trim() || null : null,
        site,
        alarmTime,
        alarmKey: makeAlarmKey(alarmName, site),
        consecNbr: null,
        cellName: null,
        device: null,
        neName: null,
      },
    };
  }

  const hw = HUAWEI_RE.exec(text);
  if (hw?.groups) {
    const g = hw.groups as { ne: string; name: string; sev: string };
    const alarmName = g.name.trim();
    const site = g.ne.trim();
    return {
      ok: true,
      value: {
        format: "HUAWEI",
        isClear: false,
        alarmName,
        nameSuffix: null,
        site,
        severity: g.sev.trim(),
        alarmTime: null,
        alarmKey: makeAlarmKey(alarmName, site),
      },
    };
  }

  return { ok: false, error: "unrecognised subject format" };
}
