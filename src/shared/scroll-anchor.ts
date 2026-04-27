import type { VirtualItemKey, Virtualizer } from "../core";

export interface ScrollAnchorSnapshot {
  key: VirtualItemKey;
  index: number;
  itemCount: number;
  offset: number;
  atStart: boolean;
  atEnd: boolean;
}

export function resolveAnchorIndex(
  virtualizer: Virtualizer<VirtualItemKey>,
  snapshot: ScrollAnchorSnapshot
): number {
  const indexFromKey = virtualizer.getIndexForKey(snapshot.key);
  if (indexFromKey !== -1) {
    return indexFromKey;
  }

  const nextCount = virtualizer.getCount();
  if (nextCount <= 0) {
    return -1;
  }

  const prependedCount =
    snapshot.atStart && nextCount > snapshot.itemCount
      ? nextCount - snapshot.itemCount
      : 0;

  return clamp(snapshot.index + prependedCount, 0, nextCount - 1);
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
