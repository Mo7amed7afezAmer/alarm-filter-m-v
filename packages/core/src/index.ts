// Pure domain logic: parser, classifier, matching engine. No I/O in this package.

export type Category = "DOWN" | "POWER" | "OTHER";

export const CATEGORIES: readonly Category[] = ["DOWN", "POWER", "OTHER"] as const;
