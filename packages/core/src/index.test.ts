import { describe, expect, it } from "vitest";
import { CATEGORIES } from "./index.js";

describe("core scaffold", () => {
  it("exposes the three categories", () => {
    expect(CATEGORIES).toEqual(["DOWN", "POWER", "OTHER"]);
  });
});
