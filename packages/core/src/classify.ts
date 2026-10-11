import type { Category } from "./index.js";

export interface RuleRecord {
  pattern: string;
  category: Category;
  priority: number;
}

/** §6: case-insensitive substring match on alarmName; lowest priority number wins. */
export function classify(alarmName: string, rules: readonly RuleRecord[]): Category {
  const name = alarmName.toUpperCase();
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    if (r.pattern && name.includes(r.pattern.toUpperCase())) return r.category;
  }
  return "OTHER";
}
