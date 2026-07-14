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

  it("expands the rendered range with pixel overscan", () => {
    const virtualizer = createVirtualizer({
      count: 20,
      estimateSize: 20,
      overscan: 0,
      overscanPx: 40
    });

    const range = virtualizer.getVirtualRange(100, 40);

    expect(range.items.map((item) => item.index)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it("supports directional pixel overscan", () => {
    const virtualizer = createVirtualizer({
      count: 20,
      estimateSize: 20,
      overscan: 0,
      overscanBeforePx: 0,
      overscanAfterPx: 40
    });

    expect(
      virtualizer.getVirtualRange(100, 40).items.map((item) => item.index)
    ).toEqual([5, 6, 7, 8]);

    virtualizer.updateOptions({
      count: 20,
      estimateSize: 20,
      overscan: 0,
      overscanBeforePx: 40,
      overscanAfterPx: 0
    });

    expect(
      virtualizer.getVirtualRange(100, 40).items.map((item) => item.index)
    ).toEqual([3, 4, 5, 6]);
  });

  it("does not rebuild layout for stable option functions", () => {
    let estimateCalls = 0;
    const estimateSize = () => {
      estimateCalls += 1;
      return 20;
    };
    const getItemKey = (index: number) => `item-${index}`;
    const virtualizer = createVirtualizer({
      count: 5,
      estimateSize,
      getItemKey
    });

    virtualizer.getVirtualRange(0, 40);
    expect(estimateCalls).toBe(5);

    virtualizer.updateOptions({
      count: 5,
      estimateSize,
      getItemKey,
      overscan: 4
    });
    virtualizer.getVirtualRange(20, 40);
    expect(estimateCalls).toBe(5);

    virtualizer.invalidateLayout();
    virtualizer.getVirtualRange(20, 40);
    expect(estimateCalls).toBe(10);
  });
});
