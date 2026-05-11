import { describe, expect, it } from "vitest";
import { createVirtualizer } from "../src/core";

describe("Virtualizer", () => {
  it("returns a visible range with overscan for fixed sizes", () => {
    const virtualizer = createVirtualizer({
      count: 100,
      estimateSize: 20,
      overscan: 1
    });

    const range = virtualizer.getVirtualRange(100, 60);

    expect(range.totalSize).toBe(2000);
    expect(range.startIndex).toBe(4);
    expect(range.endIndex).toBe(8);
    expect(range.items.map((item) => item.index)).toEqual([4, 5, 6, 7, 8]);
  });

  it("includes gaps in item starts and total size", () => {
    const virtualizer = createVirtualizer({
      count: 3,
      estimateSize: 10,
      gap: 5,
      overscan: 0
    });

    const range = virtualizer.getVirtualRange(0, 40);

    expect(range.totalSize).toBe(40);
    expect(range.items.map((item) => item.start)).toEqual([0, 15, 30]);
  });

  it("updates layout when measured sizes change", () => {
    const virtualizer = createVirtualizer({
      count: 3,
      estimateSize: 20,
      overscan: 0
    });

    expect(virtualizer.getTotalSize()).toBe(60);
    expect(virtualizer.measure(1, 50)).toBe(true);
    expect(virtualizer.getTotalSize()).toBe(90);

    const range = virtualizer.getVirtualRange(0, 100);
    expect(range.items.map((item) => item.size)).toEqual([20, 50, 20]);
  });

  it("keeps measured sizes attached to stable keys when items are prepended", () => {
    let items = [
      { id: "b" },
      { id: "c" }
    ];
    const virtualizer = createVirtualizer({
      count: items.length,
      estimateSize: 20,
      getItemKey: (index) => items[index]?.id ?? index
    });

    expect(virtualizer.measure(0, 60)).toBe(true);
    expect(virtualizer.getSizeForIndex(0)).toBe(60);

    items = [{ id: "a" }, ...items];
    virtualizer.updateOptions({
      count: items.length,
      estimateSize: 20,
      getItemKey: (index) => items[index]?.id ?? index
    });

    expect(virtualizer.getSizeForIndex(0)).toBe(20);
    expect(virtualizer.getSizeForIndex(1)).toBe(60);
  });

  it("calculates scroll offsets for index alignment", () => {
    const virtualizer = createVirtualizer({
      count: 10,
      estimateSize: 25
    });

    expect(
      virtualizer.getOffsetForIndex(4, {
        align: "start",
        viewportSize: 100
      })
    ).toBe(100);
    expect(
      virtualizer.getOffsetForIndex(4, {
        align: "end",
        viewportSize: 100
      })
    ).toBe(25);
  });

  it("calculates scroll offsets from stable keys", () => {
    const keys = ["a", "b", "c", "d"];
    const virtualizer = createVirtualizer({
      count: keys.length,
      estimateSize: 25,
      getItemKey: (index) => keys[index] ?? index
    });

    expect(
      virtualizer.getOffsetForKey("c", {
        align: "start",
        viewportSize: 50
      })
    ).toBe(50);
    expect(
      virtualizer.getOffsetForKey("missing", {
        align: "start",
        viewportSize: 50
      })
    ).toBeNull();
  });
});
