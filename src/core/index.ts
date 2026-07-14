export type VirtualItemKey = string | number;

export type EstimateSize = number | ((index: number) => number);

export interface VirtualizerOptions<TKey extends VirtualItemKey = number> {
  count: number;
  estimateSize: EstimateSize;
  overscan?: number;
  overscanPx?: number;
  /** Pixel overscan before the viewport. Defaults to overscanPx. */
  overscanBeforePx?: number;
  /** Pixel overscan after the viewport. Defaults to overscanPx. */
  overscanAfterPx?: number;
  gap?: number;
  getItemKey?: (index: number) => TKey;
}

export interface VirtualItem<TKey extends VirtualItemKey = number> {
  index: number;
  key: TKey;
  start: number;
  size: number;
  end: number;
}

export interface VirtualRange<TKey extends VirtualItemKey = number> {
  items: Array<VirtualItem<TKey>>;
  totalSize: number;
  startIndex: number;
  endIndex: number;
  offsetBefore: number;
  offsetAfter: number;
}

export interface ScrollToIndexOptions {
  align?: "start" | "center" | "end" | "auto";
  viewportSize: number;
  currentOffset?: number;
}

const DEFAULT_OVERSCAN = 2;

export class Virtualizer<TKey extends VirtualItemKey = number> {
  private options: Required<Omit<VirtualizerOptions<TKey>, "getItemKey">> & {
    getItemKey?: (index: number) => TKey;
  };

  private measuredSizes = new Map<TKey, number>();

  private starts: number[] = [];

  private sizes: number[] = [];

  private keys: TKey[] = [];

  private keyToIndex = new Map<TKey, number>();

  private totalSize = 0;

  private layoutDirty = true;

  constructor(options: VirtualizerOptions<TKey>) {
    this.options = normalizeOptions(options);
  }

  updateOptions(options: VirtualizerOptions<TKey>): void {
    const previousCount = this.options.count;
    const previousEstimateSize = this.options.estimateSize;
    const previousGap = this.options.gap;
    const previousGetItemKey = this.options.getItemKey;

    this.options = normalizeOptions(options);

    if (
      previousCount !== this.options.count ||
      previousEstimateSize !== this.options.estimateSize ||
      previousGap !== this.options.gap ||
      previousGetItemKey !== this.options.getItemKey
    ) {
      this.layoutDirty = true;
    }
  }

  measure(index: number, size: number): boolean {
    if (index < 0 || index >= this.options.count || !Number.isFinite(size)) {
      return false;
    }

    const key = this.getKeyForIndex(index);
    const normalizedSize = Math.max(0, size);
    if (this.measuredSizes.get(key) === normalizedSize) {
      return false;
    }

    this.measuredSizes.set(key, normalizedSize);
    this.layoutDirty = true;
    return true;
  }

  unmeasure(index: number): boolean {
    if (index < 0 || index >= this.options.count) {
      return false;
    }

    const deleted = this.measuredSizes.delete(this.getKeyForIndex(index));
    if (deleted) {
      this.layoutDirty = true;
    }
    return deleted;
  }

  unmeasureByKey(key: TKey): boolean {
    const deleted = this.measuredSizes.delete(key);
    if (deleted) {
      this.layoutDirty = true;
    }
    return deleted;
  }

  resetMeasurements(): void {
    if (this.measuredSizes.size > 0) {
      this.measuredSizes.clear();
      this.layoutDirty = true;
    }
  }

  invalidateLayout(): void {
    this.layoutDirty = true;
  }

  getTotalSize(): number {
    this.ensureLayout();
    return this.totalSize;
  }

  getCount(): number {
    return this.options.count;
  }

  getKeyForIndex(index: number): TKey {
    return this.options.getItemKey?.(index) ?? (index as TKey);
  }

  getIndexForKey(key: TKey): number {
    this.ensureLayout();
    return this.keyToIndex.get(key) ?? -1;
  }

  getStartForIndex(index: number): number {
    this.ensureLayout();
    return this.starts[index] ?? 0;
  }

  getSizeForIndex(index: number): number {
    this.ensureLayout();
    return this.sizes[index] ?? 0;
  }

  getOffsetForIndex(index: number, options: ScrollToIndexOptions): number {
    this.ensureLayout();

    if (this.options.count === 0) {
      return 0;
    }

    const boundedIndex = clamp(index, 0, this.options.count - 1);
    const start = this.starts[boundedIndex] ?? 0;
    const size = this.sizes[boundedIndex] ?? 0;
    const end = start + size;
    const viewportSize = Math.max(0, options.viewportSize);
    const currentOffset = Math.max(0, options.currentOffset ?? 0);
    const maxOffset = Math.max(0, this.totalSize - viewportSize);
    const align = options.align ?? "start";

    if (align === "auto") {
      if (start >= currentOffset && end <= currentOffset + viewportSize) {
        return currentOffset;
      }

      if (start < currentOffset) {
        return clamp(start, 0, maxOffset);
      }

      return clamp(end - viewportSize, 0, maxOffset);
    }

    if (align === "end") {
      return clamp(end - viewportSize, 0, maxOffset);
    }

    if (align === "center") {
      return clamp(start - (viewportSize - size) / 2, 0, maxOffset);
    }

    return clamp(start, 0, maxOffset);
  }

  getOffsetForKey(key: TKey, options: ScrollToIndexOptions): number | null {
    const index = this.getIndexForKey(key);
    if (index === -1) {
      return null;
    }

    return this.getOffsetForIndex(index, options);
  }

  getVirtualRange(scrollOffset: number, viewportSize: number): VirtualRange<TKey> {
    this.ensureLayout();

    const count = this.options.count;
    if (count === 0 || viewportSize <= 0) {
      return {
        items: [],
        totalSize: this.totalSize,
        startIndex: -1,
        endIndex: -1,
        offsetBefore: 0,
        offsetAfter: this.totalSize
      };
    }

    const safeOffset = clamp(scrollOffset, 0, Math.max(0, this.totalSize));
    const safeViewportSize = Math.max(0, viewportSize);
    const visibleStart = this.findFirstVisibleIndex(
      Math.max(0, safeOffset - this.options.overscanBeforePx)
    );
    const visibleEnd = this.findLastVisibleIndex(
      safeOffset + safeViewportSize + this.options.overscanAfterPx
    );
    const startIndex = clamp(visibleStart - this.options.overscan, 0, count - 1);
    const endIndex = clamp(visibleEnd + this.options.overscan, startIndex, count - 1);
    const items: Array<VirtualItem<TKey>> = [];

    for (let index = startIndex; index <= endIndex; index += 1) {
      const start = this.starts[index] ?? 0;
      const size = this.sizes[index] ?? 0;
      items.push({
        index,
        key: this.keys[index] ?? this.getKeyForIndex(index),
        start,
        size,
        end: start + size
      });
    }

    const first = items[0];
    const last = items[items.length - 1];

    return {
      items,
      totalSize: this.totalSize,
      startIndex,
      endIndex,
      offsetBefore: first?.start ?? 0,
      offsetAfter: Math.max(0, this.totalSize - (last?.end ?? 0))
    };
  }

  private ensureLayout(): void {
    if (!this.layoutDirty) {
      return;
    }

    const { count, gap } = this.options;
    this.starts = new Array<number>(count);
    this.sizes = new Array<number>(count);
    this.keys = new Array<TKey>(count);
    this.keyToIndex = new Map<TKey, number>();

    let offset = 0;
    for (let index = 0; index < count; index += 1) {
      const key = this.getKeyForIndex(index);
      const size = this.getSize(index);
      this.keys[index] = key;
      this.keyToIndex.set(key, index);
      this.starts[index] = offset;
      this.sizes[index] = size;
      offset += size;

      if (index < count - 1) {
        offset += gap;
      }
    }

    for (const key of this.measuredSizes.keys()) {
      if (!this.keyToIndex.has(key)) {
        this.measuredSizes.delete(key);
      }
    }

    this.totalSize = offset;
    this.layoutDirty = false;
  }

  private getSize(index: number): number {
    const measuredSize = this.measuredSizes.get(this.getKeyForIndex(index));
    if (measuredSize !== undefined) {
      return measuredSize;
    }

    const estimatedSize =
      typeof this.options.estimateSize === "function"
        ? this.options.estimateSize(index)
        : this.options.estimateSize;

    return Number.isFinite(estimatedSize) ? Math.max(0, estimatedSize) : 0;
  }

  private findFirstVisibleIndex(offset: number): number {
    let low = 0;
    let high = this.options.count - 1;
    let answer = high;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const end = (this.starts[mid] ?? 0) + (this.sizes[mid] ?? 0);

      if (end <= offset) {
        low = mid + 1;
      } else {
        answer = mid;
        high = mid - 1;
      }
    }

    return answer;
  }

  private findLastVisibleIndex(offset: number): number {
    let low = 0;
    let high = this.options.count - 1;
    let answer = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const start = this.starts[mid] ?? 0;

      if (start < offset) {
        answer = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return answer;
  }
}

export function createVirtualizer<TKey extends VirtualItemKey = number>(
  options: VirtualizerOptions<TKey>
): Virtualizer<TKey> {
  return new Virtualizer(options);
}

function normalizeOptions<TKey extends VirtualItemKey>(
  options: VirtualizerOptions<TKey>
): Required<Omit<VirtualizerOptions<TKey>, "getItemKey">> & {
  getItemKey?: (index: number) => TKey;
} {
  return {
    count: Math.max(0, Math.floor(options.count)),
    estimateSize: options.estimateSize,
    overscan: Math.max(0, Math.floor(options.overscan ?? DEFAULT_OVERSCAN)),
    overscanPx: Math.max(0, options.overscanPx ?? 0),
    overscanBeforePx: Math.max(
      0,
      options.overscanBeforePx ?? options.overscanPx ?? 0
    ),
    overscanAfterPx: Math.max(
      0,
      options.overscanAfterPx ?? options.overscanPx ?? 0
    ),
    gap: Math.max(0, options.gap ?? 0),
    getItemKey: options.getItemKey
  };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}
