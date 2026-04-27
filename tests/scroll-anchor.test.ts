import { describe, expect, it } from "vitest";
import { createVirtualizer } from "../src/core";
import { resolveAnchorIndex } from "../src/shared/scroll-anchor";

describe("resolveAnchorIndex", () => {
  it("prefers a stable key match when the anchor key still exists", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const virtualizer = createVirtualizer({
      count: items.length,
      estimateSize: 20,
      getItemKey: (index) => items[index]?.id ?? index
    });

    expect(
      resolveAnchorIndex(virtualizer, {
        key: "b",
        index: 1,
        itemCount: 2,
        offset: 0,
        atStart: false,
        atEnd: false
      })
    ).toBe(1);
  });

  it("falls back to the prepended position when the old key is gone at the top", () => {
    const virtualizer = createVirtualizer({
      count: 5,
      estimateSize: 20
    });

    expect(
      resolveAnchorIndex(virtualizer, {
        key: "__missing__",
        index: 0,
        itemCount: 2,
        offset: 0,
        atStart: true,
        atEnd: false
      })
    ).toBe(3);
  });

  it("falls back to the previous index when the old key is gone away from the top", () => {
    const virtualizer = createVirtualizer({
      count: 5,
      estimateSize: 20
    });

    expect(
      resolveAnchorIndex(virtualizer, {
        key: "__missing__",
        index: 2,
        itemCount: 2,
        offset: 0,
        atStart: false,
        atEnd: false
      })
    ).toBe(2);
  });
});
