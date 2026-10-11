/**
 * Run the parser over samples/subjects.txt and report failures + shape counts.
 *
 *   corepack pnpm parse:samples
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSubject } from "../packages/core/src/parser.js";
import { loadDotEnv, ROOT } from "./lib/google.js";

loadDotEnv();
const timeZone = process.env.ALARM_TZ || undefined;

const lines = readFileSync(path.join(ROOT, "samples", "subjects.txt"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean);

const counts: Record<string, number> = {};
const failures: string[] = [];

for (const line of lines) {
  const subject = line.slice(line.indexOf(" | ") + 3);
  const r = parseSubject(subject, { timeZone });
  if (!r.ok) {
    failures.push(`${r.error}: ${subject}`);
    continue;
  }
  const shape = `${r.value.format}${r.value.isClear ? " clear" : " alarm"}`;
  counts[shape] = (counts[shape] ?? 0) + 1;
}

console.log(`Parsed ${lines.length} subjects (ALARM_TZ=${timeZone ?? "Africa/Cairo (default)"})`);
for (const [shape, n] of Object.entries(counts)) console.log(`  ${shape.padEnd(14)} ${n}`);
console.log(`  failed         ${failures.length}`);
for (const f of failures) console.log(`    - ${f}`);
process.exit(failures.length ? 1 : 0);
