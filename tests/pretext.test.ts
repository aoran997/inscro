import { describe, expect, it } from "vitest";
import { createPretextEstimateSize } from "../src/pretext";

describe("createPretextEstimateSize", () => {
  it("returns the fallback size when browser text measurement is unavailable", () => {
    const errors: unknown[] = [];
    const estimateSize = createPretextEstimateSize<{ text: string }>({
      getText: (item) => item.text,
      font: "14px Inter",
      width: 240,
      lineHeight: 22,
      paddingBlock: 12,
      fallbackSize: 88,
      onMeasureError: (error) => errors.push(error)
    });

    expect(estimateSize(0, { text: "Hello Pretext" })).toBe(88);
    expect(errors).toHaveLength(1);
  });

  it("returns the fallback size without measuring when width is zero", () => {
    const errors: unknown[] = [];
    const estimateSize = createPretextEstimateSize<{ text: string }>({
      getText: (item) => item.text,
      font: "14px Inter",
      width: 0,
      lineHeight: 22,
      fallbackSize: 64,
      onMeasureError: (error) => errors.push(error)
    });

    expect(estimateSize(0, { text: "Hello Pretext" })).toBe(64);
    expect(errors).toHaveLength(0);
  });
});
