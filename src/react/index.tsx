import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { Virtualizer } from "../core";
import type {
  EstimateSize,
  ScrollToIndexOptions,
  VirtualItem,
  VirtualItemKey,
  VirtualRange
} from "../core";
import {
  resolveAnchorIndex,
  type ScrollAnchorSnapshot
} from "../shared/scroll-anchor";

type Axis = "vertical" | "horizontal";

interface ItemObserverRecord {
  node: HTMLElement;
  index: number;
  observer?: ResizeObserver;
  cleanupImages?: () => void;
}

interface ScrollSample {
  scrollOffset: number;
  viewportSize: number;
  timestamp: number;
}

interface ReachRecord {
  edgeKey: VirtualItemKey;
  callback?: () => void;
}

export interface ResetVirtualListOptions {
  scrollToBottom?: boolean;
}

export type ReactEstimateSize<TItem> =
  | number
  | ((index: number, item: TItem) => number);

/**
 * Options for React `useVirtualList`.
 *
 * 用法示例：
 *
 * ```tsx
 * const list = useVirtualList({
 *   items: messages,
 *   estimateSize: 84,
 *   getItemKey: (message) => message.id,
 *   initialScrollToBottom: true,
 *   preserveScrollPosition: true,
 *   edgeThreshold: 120,
 *   onReachStart: loadOlderMessages
 * });
 * ```
 */
export interface UseVirtualListOptions<TItem> {
  /** Full data array to virtualize. 要虚拟滚动渲染的完整数据数组。 */
  items: readonly TItem[];
  /** Estimated item size before the real DOM size is measured. DOM 真实尺寸测量前使用的预估 item 尺寸。 */
  estimateSize: ReactEstimateSize<TItem>;
  /** Extra item count rendered before and after the visible range. Defaults to 2. 可视区域前后额外渲染的 item 数量，默认 2。 */
  overscan?: number;
  /** Extra pixel buffer rendered before and after the visible range. 可视区域前后额外渲染的像素缓冲。 */
  overscanPx?: number;
  /** Space in pixels between adjacent items. Defaults to 0. 相邻 item 之间的像素间距，默认 0。 */
  gap?: number;
  /** Render and scroll on the horizontal axis instead of vertical. 是否使用横向虚拟滚动，默认纵向。 */
  horizontal?: boolean;
  /** Stable key resolver used to keep measurements and scroll anchors attached to the same item. 稳定 key 生成函数，用来把测量结果和滚动锚点绑定到同一条数据。 */
  getItemKey?: (item: TItem, index: number) => VirtualItemKey;
  /** Keep the current visible content anchored when items are prepended or measured sizes change. Defaults to true. prepend 数据或 item 高度变化时保持当前可见内容位置，默认 true。 */
  preserveScrollPosition?: boolean;
  /** Scroll to the bottom after the first non-empty render. 首次有数据渲染后自动滚动到底部，适合聊天记录。 */
  initialScrollToBottom?: boolean;
  /** Keep the list pinned to the bottom when it is already near the bottom and content changes. 当前已经接近底部时，新增内容或高度变化后继续贴底。 */
  stickToBottom?: boolean;
  /** Distance in pixels from the bottom that still counts as being at the bottom. Defaults to 24. 距离底部多少像素内仍认为处于底部，默认 24。 */
  bottomThreshold?: number;
  /** Distance in pixels from either edge used to trigger reach callbacks. Defaults to 0. 距离顶部或底部多少像素时触发边缘回调，默认 0。 */
  edgeThreshold?: number;
  /** Called when scrolling reaches the start edge within edgeThreshold. 滚动到起始边缘附近时触发，常用于加载更早数据。 */
  onReachStart?: () => void;
  /** Called when scrolling reaches the end edge within edgeThreshold. 滚动到结束边缘附近时触发，常用于加载更新数据。 */
  onReachEnd?: () => void;
}

export interface ReactVirtualItem<TItem>
  extends VirtualItem<VirtualItemKey> {
  item: TItem;
  measureRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
}

export interface UseVirtualListReturn<TItem> {
  containerRef: RefObject<HTMLDivElement>;
  virtualItems: Array<ReactVirtualItem<TItem>>;
  range: VirtualRange<VirtualItemKey>;
  totalSize: number;
  innerStyle: CSSProperties;
  scrollToIndex: (
    index: number,
    align?: ScrollToIndexOptions["align"],
    behavior?: ScrollBehavior
  ) => void;
  scrollToKey: (
    key: VirtualItemKey,
    align?: ScrollToIndexOptions["align"],
    behavior?: ScrollBehavior
  ) => void;
  scrollToOffset: (offset: number, behavior?: ScrollBehavior) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  reset: (options?: ResetVirtualListOptions) => void;
}

export interface VirtualListRenderContext<TItem> {
  item: TItem;
  index: number;
  virtualItem: ReactVirtualItem<TItem>;
}

export interface VirtualListProps<TItem>
  extends UseVirtualListOptions<TItem> {
  renderItem: (context: VirtualListRenderContext<TItem>) => ReactNode;
  className?: string;
  innerClassName?: string;
  itemClassName?:
    | string
    | ((context: VirtualListRenderContext<TItem>) => string | undefined);
  style?: CSSProperties;
  innerStyle?: CSSProperties;
  itemStyle?:
    | CSSProperties
    | ((context: VirtualListRenderContext<TItem>) => CSSProperties | undefined);
  role?: string;
  tabIndex?: number;
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useVirtualList<TItem>(
  options: UseVirtualListOptions<TItem>
): UseVirtualListReturn<TItem> {
  const {
    items,
    estimateSize,
    overscan,
    overscanPx,
    gap,
    horizontal = false,
    getItemKey,
    preserveScrollPosition = true,
    initialScrollToBottom = false,
    stickToBottom = false,
    bottomThreshold = 24,
    edgeThreshold = 0,
    onReachStart,
    onReachEnd
  } = options;
  const axis: Axis = horizontal ? "horizontal" : "vertical";
  const defaultGetItemKeyRef = useRef<
    ((item: TItem, index: number) => VirtualItemKey) | undefined
  >(undefined);
  if (!defaultGetItemKeyRef.current) {
    defaultGetItemKeyRef.current = createDefaultGetItemKey<TItem>();
  }
  const resolvedGetItemKey = getItemKey ?? defaultGetItemKeyRef.current;
  const firstItemKey =
    items.length > 0
      ? resolvedGetItemKey(items[0] as TItem, 0)
      : "__empty__";
  const lastItemKey =
    items.length > 0
      ? resolvedGetItemKey(items[items.length - 1] as TItem, items.length - 1)
      : "__empty__";
  const listIdentity = `${items.length}:${String(firstItemKey)}:${String(lastItemKey)}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const [viewport, setViewport] = useState({
    scrollOffset: 0,
    viewportSize: 0,
    dynamicOverscanPx: 0
  });
  const virtualizerRef = useRef<Virtualizer<VirtualItemKey>>();
  const itemObserversRef = useRef(new Map<VirtualItemKey, ItemObserverRecord>());
  const anchorSnapshotRef = useRef<ScrollAnchorSnapshot | null>(null);
  const pendingMeasureAnchorSnapshotRef =
    useRef<ScrollAnchorSnapshot | null>(null);
  const previousListIdentityRef = useRef(listIdentity);
  const initialScrollDoneRef = useRef(false);
  const bottomIntentRef = useRef(false);
  const lastReachStartRef = useRef<ReachRecord | null>(null);
  const lastReachEndRef = useRef<ReachRecord | null>(null);
  const lastScrollSampleRef = useRef<ScrollSample | null>(null);
  const latestTotalSizeRef = useRef(0);
  const measureFrameRef = useRef(0);
  const dirtyMeasurementsRef = useRef(
    new Map<VirtualItemKey, ItemObserverRecord>()
  );

  if (!virtualizerRef.current) {
    virtualizerRef.current = new Virtualizer<VirtualItemKey>({
      count: items.length,
      estimateSize: createEstimateSize(estimateSize, items),
      overscan,
      overscanPx,
      gap,
      getItemKey: createGetItemKey(resolvedGetItemKey, items)
    });
  }

  const virtualizer = virtualizerRef.current;
  virtualizer.updateOptions({
    count: items.length,
    estimateSize: createEstimateSize(estimateSize, items),
    overscan,
    overscanPx: Math.max(0, overscanPx ?? 0) + viewport.dynamicOverscanPx,
    gap,
    getItemKey: createGetItemKey(resolvedGetItemKey, items)
  });

  const readViewport = useCallback((source: "scroll" | "layout" = "layout") => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const nextViewport = getScrollMetrics(node, axis);
    const dynamicOverscanPx =
      source === "scroll"
        ? getDynamicOverscanPx(
            lastScrollSampleRef.current,
            nextViewport,
            typeof performance === "undefined" ? Date.now() : performance.now()
          )
        : 0;
    lastScrollSampleRef.current = {
      ...nextViewport,
      timestamp:
        typeof performance === "undefined" ? Date.now() : performance.now()
    };

    if (
      source === "scroll" &&
      bottomIntentRef.current &&
      !isAtEnd(nextViewport, latestTotalSizeRef.current, bottomThreshold)
    ) {
      bottomIntentRef.current = false;
    }

    setViewport((previous) =>
      previous.scrollOffset === nextViewport.scrollOffset &&
      previous.viewportSize === nextViewport.viewportSize &&
      previous.dynamicOverscanPx === dynamicOverscanPx
        ? previous
        : { ...nextViewport, dynamicOverscanPx }
    );
  }, [axis, bottomThreshold]);

  useIsomorphicLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    readViewport();

    let viewportFrame = 0;
    let scrollFrame = 0;
    let scrollTimer = 0;

    const scheduleViewportRead = () => {
      if (viewportFrame !== 0) {
        return;
      }

      viewportFrame = window.requestAnimationFrame(() => {
        viewportFrame = 0;
        readViewport();
      });
    };

    const scheduleScrollRead = () => {
      node.classList.add("is-scrolling", "inscro-is-scrolling");
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        node.classList.remove("is-scrolling", "inscro-is-scrolling");
      }, 120);

      if (scrollFrame !== 0) {
        return;
      }

      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        readViewport("scroll");
      });
    };

    node.addEventListener("scroll", scheduleScrollRead, { passive: true });

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleViewportRead);
      resizeObserver.observe(node);
    } else {
      window.addEventListener("resize", scheduleViewportRead);
    }

    return () => {
      if (viewportFrame !== 0) {
        window.cancelAnimationFrame(viewportFrame);
      }

      if (scrollFrame !== 0) {
        window.cancelAnimationFrame(scrollFrame);
      }

      window.clearTimeout(scrollTimer);
      node.classList.remove("is-scrolling", "inscro-is-scrolling");
      node.removeEventListener("scroll", scheduleScrollRead);
      resizeObserver?.disconnect();

      if (typeof ResizeObserver === "undefined") {
        window.removeEventListener("resize", scheduleViewportRead);
      }
    };
  }, [readViewport]);

  const measureRef = useCallback(
    (index: number, key: VirtualItemKey) => (node: HTMLElement | null) => {
      const itemObservers = itemObserversRef.current;
      const previousRecord = itemObservers.get(key);

      if (previousRecord?.node === node && previousRecord.index === index) {
        return;
      }

      if (previousRecord) {
        cleanupItemObserver(previousRecord);
        itemObservers.delete(key);
      }

      if (!node) {
        return;
      }

      const record: ItemObserverRecord = { node, index };

      const measureNow = () => {
        dirtyMeasurementsRef.current.set(key, record);
        flushMeasurements();
      };

      const flushMeasurements = () => {
        const containerNode = containerRef.current;
        const metrics = containerNode
          ? getScrollMetrics(containerNode, axis)
          : null;
        const previousAnchor =
          containerNode && metrics
            ? createAnchorSnapshot(
                virtualizer,
                metrics,
                edgeThreshold,
                bottomThreshold
              )
            : null;

        let changed = false;
        for (const [dirtyKey, dirtyRecord] of dirtyMeasurementsRef.current) {
          if (itemObservers.get(dirtyKey) !== dirtyRecord) {
            continue;
          }

          const rect = dirtyRecord.node.getBoundingClientRect();
          const size = axis === "horizontal" ? rect.width : rect.height;
          changed = virtualizer.measure(dirtyRecord.index, size) || changed;
        }

        dirtyMeasurementsRef.current.clear();

        if (changed) {
          pendingMeasureAnchorSnapshotRef.current ??= previousAnchor;
          setMeasurementVersion((value) => value + 1);
        }
      };

      const scheduleMeasure = () => {
        if (typeof window === "undefined") {
          measureNow();
          return;
        }

        dirtyMeasurementsRef.current.set(key, record);

        if (measureFrameRef.current !== 0) {
          return;
        }

        measureFrameRef.current = window.requestAnimationFrame(() => {
          measureFrameRef.current = 0;
          flushMeasurements();
        });
      };

      itemObservers.set(key, record);
      scheduleMeasure();

      if (typeof ResizeObserver !== "undefined") {
        record.observer = new ResizeObserver(scheduleMeasure);
        record.observer.observe(node);
      }

      record.cleanupImages = observeImageLoads(node, scheduleMeasure);
    },
    [axis, bottomThreshold, edgeThreshold, virtualizer]
  );

  useIsomorphicLayoutEffect(
    () => () => {
      for (const record of itemObserversRef.current.values()) {
        cleanupItemObserver(record);
      }

      itemObserversRef.current.clear();
      dirtyMeasurementsRef.current.clear();
      if (measureFrameRef.current !== 0 && typeof window !== "undefined") {
        window.cancelAnimationFrame(measureFrameRef.current);
        measureFrameRef.current = 0;
      }
    },
    []
  );

  const range = useMemo(
    () =>
      virtualizer.getVirtualRange(
        viewport.scrollOffset,
        viewport.viewportSize
      ),
    [
      virtualizer,
      viewport.scrollOffset,
      viewport.viewportSize,
      viewport.dynamicOverscanPx,
      measurementVersion,
      items,
      estimateSize,
      overscan,
      overscanPx,
      gap,
      getItemKey
    ]
  );

  const virtualItems = useMemo(
    () =>
      range.items.map((virtualItem) => ({
        ...virtualItem,
        item: items[virtualItem.index] as TItem,
        measureRef: measureRef(virtualItem.index, virtualItem.key),
        style: getItemStyle(axis, virtualItem)
      })),
    [axis, items, measureRef, range.items]
  );

  const totalSize = range.totalSize;
  latestTotalSizeRef.current = totalSize;
  const innerStyle = useMemo(
    () => getInnerStyle(axis, totalSize),
    [axis, totalSize]
  );

  useIsomorphicLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const metrics = getScrollMetrics(node, axis);
    if (metrics.viewportSize <= 0) {
      return;
    }

    let nextOffset: number | undefined;

    if (
      initialScrollToBottom &&
      !initialScrollDoneRef.current &&
      items.length > 0
    ) {
      nextOffset = Math.max(0, totalSize - metrics.viewportSize);
      initialScrollDoneRef.current = true;
      bottomIntentRef.current = true;
    } else {
      const listChanged = previousListIdentityRef.current !== listIdentity;
      const previousAnchor = listChanged
        ? anchorSnapshotRef.current
        : pendingMeasureAnchorSnapshotRef.current ?? anchorSnapshotRef.current;
      pendingMeasureAnchorSnapshotRef.current = null;
      previousListIdentityRef.current = listIdentity;

      if (previousAnchor) {
        if (
          bottomIntentRef.current ||
          (stickToBottom && previousAnchor.atEnd)
        ) {
          nextOffset = Math.max(0, totalSize - metrics.viewportSize);
        } else if (preserveScrollPosition) {
          const nextAnchorIndex = resolveAnchorIndex(
            virtualizer,
            previousAnchor
          );

          if (nextAnchorIndex !== -1) {
            nextOffset =
              virtualizer.getStartForIndex(nextAnchorIndex) -
              previousAnchor.offset;
          }
        }
      }
    }

    if (nextOffset !== undefined) {
      const boundedOffset = clamp(
        nextOffset,
        0,
        Math.max(0, totalSize - metrics.viewportSize)
      );

      if (Math.abs(metrics.scrollOffset - boundedOffset) > 0.5) {
        setNodeScrollOffset(node, axis, boundedOffset, "auto");
      }
    }

    const nextMetrics = getScrollMetrics(node, axis);
    setViewport((previous) =>
      previous.scrollOffset === nextMetrics.scrollOffset &&
      previous.viewportSize === nextMetrics.viewportSize &&
      previous.dynamicOverscanPx === 0
        ? previous
        : { ...nextMetrics, dynamicOverscanPx: 0 }
    );
    anchorSnapshotRef.current = createAnchorSnapshot(
      virtualizer,
      nextMetrics,
      edgeThreshold,
      bottomThreshold
    );
  }, [
    axis,
    totalSize,
    measurementVersion,
    items.length,
    firstItemKey,
    lastItemKey,
    listIdentity,
    initialScrollToBottom,
    preserveScrollPosition,
    stickToBottom,
    bottomThreshold,
    virtualizer
  ]);

  useIsomorphicLayoutEffect(() => {
    if (items.length === 0) {
      initialScrollDoneRef.current = false;
      bottomIntentRef.current = false;
      lastReachStartRef.current = null;
      lastReachEndRef.current = null;
      anchorSnapshotRef.current = null;
      pendingMeasureAnchorSnapshotRef.current = null;
      lastScrollSampleRef.current = null;
    }
  }, [items.length]);

  useIsomorphicLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    anchorSnapshotRef.current = createAnchorSnapshot(
      virtualizer,
      getScrollMetrics(node, axis),
      edgeThreshold,
      bottomThreshold
    );
  }, [
    axis,
    edgeThreshold,
    viewport.scrollOffset,
    viewport.viewportSize,
    totalSize,
    bottomThreshold,
    virtualizer
  ]);

  useEffect(() => {
    if (
      viewport.viewportSize <= 0 ||
      (initialScrollToBottom && !initialScrollDoneRef.current)
    ) {
      return;
    }

    const threshold = Math.max(0, edgeThreshold);
    const atStart = viewport.scrollOffset <= threshold;
    const atEnd =
      viewport.scrollOffset + viewport.viewportSize >= totalSize - threshold;

    if (
      atStart &&
      shouldCallReach(lastReachStartRef.current, firstItemKey, onReachStart)
    ) {
      onReachStart?.();
      lastReachStartRef.current = {
        edgeKey: firstItemKey,
        callback: onReachStart
      };
    }

    if (
      atEnd &&
      shouldCallReach(lastReachEndRef.current, lastItemKey, onReachEnd)
    ) {
      onReachEnd?.();
      lastReachEndRef.current = {
        edgeKey: lastItemKey,
        callback: onReachEnd
      };
    }

    if (!atStart) {
      lastReachStartRef.current = null;
    }

    if (!atEnd) {
      lastReachEndRef.current = null;
    }
  }, [
    viewport.scrollOffset,
    viewport.viewportSize,
    totalSize,
    edgeThreshold,
    firstItemKey,
    lastItemKey,
    initialScrollToBottom,
    onReachStart,
    onReachEnd
  ]);

  const scrollToOffset = useCallback(
    (offset: number, behavior: ScrollBehavior = "auto") => {
      const node = containerRef.current;
      if (!node) {
        return;
      }

      setNodeScrollOffset(node, axis, offset, behavior);
      setViewport({ ...getScrollMetrics(node, axis), dynamicOverscanPx: 0 });
    },
    [axis]
  );

  const scrollToIndex = useCallback(
    (
      index: number,
      align: ScrollToIndexOptions["align"] = "start",
      behavior: ScrollBehavior = "auto"
    ) => {
      const node = containerRef.current;
      if (!node) {
        return;
      }

      const viewportSize =
        axis === "horizontal" ? node.clientWidth : node.clientHeight;
      const currentOffset =
        axis === "horizontal" ? node.scrollLeft : node.scrollTop;
      const offset = virtualizer.getOffsetForIndex(index, {
        align,
        viewportSize,
        currentOffset
      });

      scrollToOffset(offset, behavior);
    },
    [axis, scrollToOffset, virtualizer]
  );

  const scrollToKey = useCallback(
    (
      key: VirtualItemKey,
      align: ScrollToIndexOptions["align"] = "start",
      behavior: ScrollBehavior = "auto"
    ) => {
      const node = containerRef.current;
      if (!node) {
        return;
      }

      const viewportSize =
        axis === "horizontal" ? node.clientWidth : node.clientHeight;
      const currentOffset =
        axis === "horizontal" ? node.scrollLeft : node.scrollTop;
      const offset = virtualizer.getOffsetForKey(key, {
        align,
        viewportSize,
        currentOffset
      });

      if (offset === null) {
        return;
      }

      scrollToOffset(offset, behavior);
    },
    [axis, scrollToOffset, virtualizer]
  );

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const node = containerRef.current;
      if (!node) {
        return;
      }

      const metrics = getScrollMetrics(node, axis);
      scrollToOffset(Math.max(0, totalSize - metrics.viewportSize), behavior);
    },
    [axis, scrollToOffset, totalSize]
  );

  const reset = useCallback(
    (resetOptions: ResetVirtualListOptions = {}) => {
      virtualizer.resetMeasurements();
      anchorSnapshotRef.current = null;
      pendingMeasureAnchorSnapshotRef.current = null;
      initialScrollDoneRef.current = false;
      bottomIntentRef.current = resetOptions.scrollToBottom ?? false;
      lastReachStartRef.current = null;
      lastReachEndRef.current = null;
      lastScrollSampleRef.current = null;
      setMeasurementVersion((value) => value + 1);

      if (resetOptions.scrollToBottom) {
        scrollToBottom("auto");
      } else {
        readViewport();
      }
    },
    [readViewport, scrollToBottom, virtualizer]
  );

  return {
    containerRef,
    virtualItems,
    range,
    totalSize,
    innerStyle,
    scrollToIndex,
    scrollToKey,
    scrollToOffset,
    scrollToBottom,
    reset
  };
}

export function VirtualList<TItem>(props: VirtualListProps<TItem>) {
  const {
    renderItem,
    className,
    innerClassName,
    itemClassName,
    style,
    innerStyle,
    itemStyle,
    role = "list",
    tabIndex,
    horizontal = false
  } = props;
  const virtualList = useVirtualList(props);
  const axis: Axis = horizontal ? "horizontal" : "vertical";

  return (
    <div
      ref={virtualList.containerRef}
      className={className}
      role={role}
      tabIndex={tabIndex}
      style={{ ...getContainerStyle(axis), ...style }}
    >
      <div
        className={innerClassName}
        style={{ ...virtualList.innerStyle, ...innerStyle }}
      >
        {virtualList.virtualItems.map((virtualItem) => {
          const context = {
            item: virtualItem.item,
            index: virtualItem.index,
            virtualItem
          };
          const classNameValue =
            typeof itemClassName === "function"
              ? itemClassName(context)
              : itemClassName;
          const itemStyleValue =
            typeof itemStyle === "function" ? itemStyle(context) : itemStyle;

          return (
            <div
              key={virtualItem.key}
              ref={virtualItem.measureRef}
              className={classNameValue}
              role={role === "list" ? "listitem" : undefined}
              style={{ ...virtualItem.style, ...itemStyleValue }}
            >
              {renderItem(context)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function createEstimateSize<TItem>(
  estimateSize: ReactEstimateSize<TItem>,
  items: readonly TItem[]
): EstimateSize {
  if (typeof estimateSize === "number") {
    return estimateSize;
  }

  return (index) => estimateSize(index, items[index] as TItem);
}

function createGetItemKey<TItem>(
  getItemKey: (item: TItem, index: number) => VirtualItemKey,
  items: readonly TItem[]
) {
  return (index: number) => getItemKey(items[index] as TItem, index);
}

function createDefaultGetItemKey<TItem>() {
  const objectKeys = new WeakMap<object, VirtualItemKey>();
  let nextObjectKey = 0;

  return (item: TItem, index: number): VirtualItemKey => {
    if (
      (typeof item === "object" && item !== null) ||
      typeof item === "function"
    ) {
      const objectItem = item as object;
      let key = objectKeys.get(objectItem);

      if (key === undefined) {
        key = `__inscro_object_${nextObjectKey}`;
        nextObjectKey += 1;
        objectKeys.set(objectItem, key);
      }

      return key;
    }

    return index;
  };
}

function getContainerStyle(axis: Axis): CSSProperties {
  return {
    overflow: "auto",
    overflowAnchor: "none",
    position: "relative",
    WebkitOverflowScrolling: "touch",
    ...(axis === "horizontal"
      ? { width: "100%" }
      : { width: "100%", height: "100%" })
  };
}

function getInnerStyle(axis: Axis, totalSize: number): CSSProperties {
  return {
    position: "relative",
    ...(axis === "horizontal"
      ? { width: totalSize, height: "100%" }
      : { height: totalSize, width: "100%" })
  };
}

function getItemStyle(
  axis: Axis,
  item: VirtualItem<VirtualItemKey>
): CSSProperties {
  if (axis === "horizontal") {
    return {
      position: "absolute",
      top: 0,
      left: item.start,
      height: "100%"
    };
  }

  return {
    position: "absolute",
    top: item.start,
    left: 0,
    width: "100%"
  };
}

function getScrollMetrics(node: HTMLElement, axis: Axis) {
  return {
    scrollOffset: axis === "horizontal" ? node.scrollLeft : node.scrollTop,
    viewportSize: axis === "horizontal" ? node.clientWidth : node.clientHeight
  };
}

function getDynamicOverscanPx(
  previous: ScrollSample | null,
  next: { scrollOffset: number; viewportSize: number },
  timestamp: number
): number {
  if (!previous || next.viewportSize <= 0) {
    return 0;
  }

  const delta = Math.abs(next.scrollOffset - previous.scrollOffset);
  const elapsed = Math.max(1, timestamp - previous.timestamp);
  const pixelsPerFrame = (delta / elapsed) * 16;

  if (pixelsPerFrame < next.viewportSize * 0.25) {
    return 0;
  }

  return Math.min(next.viewportSize * 3, delta * 2);
}

function isAtEnd(
  metrics: { scrollOffset: number; viewportSize: number },
  totalSize: number,
  threshold: number
): boolean {
  return (
    metrics.scrollOffset + metrics.viewportSize >=
    totalSize - Math.max(0, threshold)
  );
}

function shouldCallReach(
  previous: ReachRecord | null,
  edgeKey: VirtualItemKey,
  callback?: () => void
): boolean {
  return Boolean(callback && !previous);
}

function setNodeScrollOffset(
  node: HTMLElement,
  axis: Axis,
  offset: number,
  behavior: ScrollBehavior
): void {
  const boundedOffset = Math.max(0, offset);

  if (behavior === "smooth") {
    if (axis === "horizontal") {
      node.scrollTo({ left: boundedOffset, behavior });
    } else {
      node.scrollTo({ top: boundedOffset, behavior });
    }

    return;
  }

  if (axis === "horizontal") {
    node.scrollLeft = boundedOffset;
  } else {
    node.scrollTop = boundedOffset;
  }
}

function createAnchorSnapshot(
  virtualizer: Virtualizer<VirtualItemKey>,
  metrics: { scrollOffset: number; viewportSize: number },
  startThreshold: number,
  bottomThreshold: number
): ScrollAnchorSnapshot | null {
  if (metrics.viewportSize <= 0) {
    return null;
  }

  const range = virtualizer.getVirtualRange(
    metrics.scrollOffset,
    metrics.viewportSize
  );
  const anchor =
    range.items.find((item) => item.end > metrics.scrollOffset) ??
    range.items[0];

  if (!anchor) {
    return null;
  }

  return {
    key: anchor.key,
    index: anchor.index,
    itemCount: virtualizer.getCount(),
    offset: anchor.start - metrics.scrollOffset,
    atStart: metrics.scrollOffset <= Math.max(0, startThreshold),
    atEnd:
      metrics.scrollOffset + metrics.viewportSize >=
      range.totalSize - Math.max(0, bottomThreshold)
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

function cleanupItemObserver(record: ItemObserverRecord): void {
  record.observer?.disconnect();
  record.cleanupImages?.();
}

function observeImageLoads(
  node: HTMLElement,
  onImageSettled: () => void
): () => void {
  const images = Array.from(node.querySelectorAll("img")).filter(
    (image) => !image.complete
  );

  for (const image of images) {
    image.addEventListener("load", onImageSettled);
    image.addEventListener("error", onImageSettled);
  }

  return () => {
    for (const image of images) {
      image.removeEventListener("load", onImageSettled);
      image.removeEventListener("error", onImageSettled);
    }
  };
}
