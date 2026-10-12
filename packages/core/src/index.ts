// Pure domain logic: parser, classifier, matching engine. No I/O in this package.

export type Category = "DOWN" | "POWER" | "OTHER";

export const CATEGORIES: readonly Category[] = ["DOWN", "POWER", "OTHER"] as const;

export * from "./parser.js";
export { parseBody, type BodyFields } from "./body.js";
export * from "./notify.js";
export { parseAlarmStamp, zonedToUtc } from "./time.js";
export * from "./classify.js";
export * from "./engine.js";
export { MemoryAlarmRepository } from "./memory-repo.js";
