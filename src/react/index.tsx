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

interface RevisionedAnchorSnapshot {
  snapshot: ScrollAnchorSnapshot;
  scrollRevision: number;
}

interface DynamicOverscan {
  before: number;
  after: number;
}

interface RenderedBounds {
  start: number;
  end: number;
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
  const itemKeys = useMemo(
    () => items.map((item, index) => resolvedGetItemKey(item, index)),
    [items, resolvedGetItemKey]
  );
  const estimateSignature = useMemo<readonly number[] | number>(
    () =>
      typeof estimateSize === "number"
        ? estimateSize
        : items.map((item, index) => estimateSize(index, item)),
    [estimateSize, items]
  );
  const listIdentityRef = useRef({ keys: itemKeys, revision: 0 });
  if (!areKeySequencesEqual(listIdentityRef.current.keys, itemKeys)) {
    listIdentityRef.current = {
      keys: itemKeys,
      revision: listIdentityRef.current.revision + 1
    };
  }
  const listIdentity = listIdentityRef.current.revision;
  const firstItemKey = itemKeys[0] ?? "__empty__";
  const lastItemKey = itemKeys[itemKeys.length - 1] ?? "__empty__";
  const containerRef = useRef<HTMLDivElement>(null);
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const [viewport, setViewport] = useState({
    scrollOffset: 0,
    viewportSize: 0,
    dynamicOverscanBeforePx: 0,
    dynamicOverscanAfterPx: 0
  });
  const virtualizerRef = useRef<Virtualizer<VirtualItemKey>>();
  const itemObserversRef = useRef(new Map<VirtualItemKey, ItemObserverRecord>());
  const itemIndicesRef = useRef(new Map<VirtualItemKey, number>());
  const measureCallbacksRef = useRef(
    new Map<VirtualItemKey, (node: HTMLElement | null) => void>()
  );
  const anchorSnapshotRef = useRef<RevisionedAnchorSnapshot | null>(null);
  const pendingMeasureAnchorSnapshotRef =
    useRef<RevisionedAnchorSnapshot | null>(null);
  const previousListIdentityRef = useRef(listIdentity);
  const initialScrollDoneRef = useRef(false);
  const bottomIntentRef = useRef(false);
  const lastReachStartRef = useRef<ReachRecord | null>(null);
  const lastReachEndRef = useRef<ReachRecord | null>(null);
  const lastScrollSampleRef = useRef<ScrollSample | null>(null);
  const latestRenderedBoundsRef = useRef<RenderedBounds | null>(null);
  const scrollRevisionRef = useRef(0);
  const isScrollingRef = useRef(false);
  const measureFrameRef = useRef(0);
  const dirtyMeasurementsRef = useRef(
    new Map<VirtualItemKey, ItemObserverRecord>()
  );

  const latestOptionsRef = useRef({
    items,
    estimateSignature,
    getItemKey: resolvedGetItemKey,
    axis,
    edgeThreshold,
    bottomThreshold
  });
  latestOptionsRef.current = {
    items,
    estimateSignature,
    getItemKey: resolvedGetItemKey,
    axis,
    edgeThreshold,
    bottomThreshold
  };

  const coreEstimateSizeRef = useRef<EstimateSize>();
  if (!coreEstimateSizeRef.current) {
    coreEstimateSizeRef.current = (index) => {
      const latest = latestOptionsRef.current;
      return typeof latest.estimateSignature === "number"
        ? latest.estimateSignature
        : latest.estimateSignature[index] ?? 0;
    };
  }

  const coreGetItemKeyRef = useRef<(index: number) => VirtualItemKey>();
  if (!coreGetItemKeyRef.current) {
    coreGetItemKeyRef.current = (index) => {
      const latest = latestOptionsRef.current;
      return latest.getItemKey(latest.items[index] as TItem, index);
    };
  }

  const previousLayoutInputsRef = useRef<{
    estimateSignature: readonly number[] | number;
    listIdentity: number;
  }>();
  const previousLayoutInputs = previousLayoutInputsRef.current;
  const shouldInvalidateLayout = Boolean(
    previousLayoutInputs &&
      (previousLayoutInputs.listIdentity !== listIdentity ||
        !areEstimateSignaturesEqual(
          previousLayoutInputs.estimateSignature,
          estimateSignature
        ))
  );
  previousLayoutInputsRef.current = {
    estimateSignature,
    listIdentity
  };

  if (!virtualizerRef.current) {
    virtualizerRef.current = new Virtualizer<VirtualItemKey>({
      count: items.length,
      estimateSize: coreEstimateSizeRef.current,
      overscan,
      overscanPx,
      gap,
      getItemKey: coreGetItemKeyRef.current
    });
  }

  const virtualizer = virtualizerRef.current;
  if (shouldInvalidateLayout) {
    virtualizer.invalidateLayout();
  }
  const baseOverscanPx = Math.max(0, overscanPx ?? 0);
  virtualizer.updateOptions({
    count: items.length,
    estimateSize: coreEstimateSizeRef.current,
    overscan,
    overscanPx: baseOverscanPx,
    overscanBeforePx:
      baseOverscanPx + viewport.dynamicOverscanBeforePx,
    overscanAfterPx: baseOverscanPx + viewport.dynamicOverscanAfterPx,
    gap,
    getItemKey: coreGetItemKeyRef.current
  });

  const readViewport = useCallback(
    (source: "scroll" | "layout" = "layout") => {
      const node = containerRef.current;
      if (!node) {
        return;
      }

      const nextViewport = getScrollMetrics(node, axis);
      const timestamp = now();
      const dynamicOverscan =
        source === "scroll"
          ? getDynamicOverscan(
              lastScrollSampleRef.current,
              nextViewport,
              timestamp
            )
          : EMPTY_DYNAMIC_OVERSCAN;

      if (source === "scroll") {
        lastScrollSampleRef.current = { ...nextViewport, timestamp };
      }

      setViewport((previous) =>
        previous.scrollOffset === nextViewport.scrollOffset &&
        previous.viewportSize === nextViewport.viewportSize &&
        previous.dynamicOverscanBeforePx === dynamicOverscan.before &&
        previous.dynamicOverscanAfterPx === dynamicOverscan.after
          ? previous
          : {
              ...nextViewport,
              dynamicOverscanBeforePx: dynamicOverscan.before,
              dynamicOverscanAfterPx: dynamicOverscan.after
            }
      );
    },
    [axis]
  );

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
      scrollRevisionRef.current += 1;
      if (!isScrollingRef.current) {
        lastScrollSampleRef.current = null;
      }
      isScrollingRef.current = true;
      node.classList.add("is-scrolling", "inscro-is-scrolling");
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        isScrollingRef.current = false;
        lastScrollSampleRef.current = null;
        node.classList.remove("is-scrolling", "inscro-is-scrolling");
        readViewport();
      }, 120);

      const nextMetrics = getScrollMetrics(node, axis);
      if (
        isOutsideRenderedBounds(nextMetrics, latestRenderedBoundsRef.current)
      ) {
        if (scrollFrame !== 0) {
          window.cancelAnimationFrame(scrollFrame);
          scrollFrame = 0;
        }
        readViewport("scroll");
        return;
      }

      if (scrollFrame !== 0) {
        return;
      }

      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        readViewport("scroll");
      });
    };

    const cancelBottomIntent = () => {
      bottomIntentRef.current = false;
      scrollRevisionRef.current += 1;
      if (anchorSnapshotRef.current) {
        anchorSnapshotRef.current = {
          ...anchorSnapshotRef.current,
          scrollRevision: scrollRevisionRef.current
        };
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isScrollIntentKey(event)) {
        cancelBottomIntent();
      }
    };

    node.addEventListener("scroll", scheduleScrollRead, { passive: true });
    node.addEventListener("wheel", cancelBottomIntent, { passive: true });
    node.addEventListener("touchstart", cancelBottomIntent, { passive: true });
    node.addEventListener("pointerdown", cancelBottomIntent, { passive: true });
    node.addEventListener("keydown", handleKeyDown);

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
      isScrollingRef.current = false;
      node.classList.remove("is-scrolling", "inscro-is-scrolling");
      node.removeEventListener("scroll", scheduleScrollRead);
      node.removeEventListener("wheel", cancelBottomIntent);
      node.removeEventListener("touchstart", cancelBottomIntent);
      node.removeEventListener("pointerdown", cancelBottomIntent);
      node.removeEventListener("keydown", handleKeyDown);
      resizeObserver?.disconnect();

      if (typeof ResizeObserver === "undefined") {
        window.removeEventListener("resize", scheduleViewportRead);
      }
    };
  }, [readViewport]);

  const flushMeasurements = useCallback(() => {
    const itemObservers = itemObserversRef.current;
    const latest = latestOptionsRef.current;
    const containerNode = containerRef.current;
    const metrics = containerNode
      ? getScrollMetrics(containerNode, latest.axis)
      : null;
    const snapshot =
      containerNode && metrics
        ? createAnchorSnapshot(
            virtualizer,
            metrics,
            latest.edgeThreshold,
            latest.bottomThreshold
          )
        : null;
    const previousAnchor = snapshot
      ? {
          snapshot,
          scrollRevision: scrollRevisionRef.current
        }
      : null;

    let changed = false;
    for (const [dirtyKey, dirtyRecord] of dirtyMeasurementsRef.current) {
      if (itemObservers.get(dirtyKey) !== dirtyRecord) {
        continue;
      }

      const index = itemIndicesRef.current.get(dirtyKey);
      if (index === undefined) {
        continue;
      }

      const rect = dirtyRecord.node.getBoundingClientRect();
      const size = latest.axis === "horizontal" ? rect.width : rect.height;
      changed = virtualizer.measure(index, size) || changed;
    }

    dirtyMeasurementsRef.current.clear();

    if (changed) {
      const pending = pendingMeasureAnchorSnapshotRef.current;
      if (
        previousAnchor &&
        (!pending ||
          pending.scrollRevision !== previousAnchor.scrollRevision)
      ) {
        pendingMeasureAnchorSnapshotRef.current = previousAnchor;
      }
      setMeasurementVersion((value) => value + 1);
    }
  }, [virtualizer]);

  const queueMeasurement = useCallback(
    (key: VirtualItemKey, record: ItemObserverRecord) => {
      dirtyMeasurementsRef.current.set(key, record);

      if (typeof window === "undefined") {
        flushMeasurements();
        return;
      }

      if (measureFrameRef.current !== 0) {
        return;
      }

      measureFrameRef.current = window.requestAnimationFrame(() => {
        measureFrameRef.current = 0;
        flushMeasurements();
      });
    },
    [flushMeasurements]
  );

  const attachItemNode = useCallback(
    (key: VirtualItemKey, node: HTMLElement | null) => {
      const itemObservers = itemObserversRef.current;
      const previousRecord = itemObservers.get(key);

      if (previousRecord?.node === node) {
        return;
      }

      if (previousRecord) {
        cleanupItemObserver(previousRecord);
        itemObservers.delete(key);
      }

      if (!node) {
        return;
      }

      const record: ItemObserverRecord = { node };
      const scheduleMeasure = () => queueMeasurement(key, record);
      itemObservers.set(key, record);
      scheduleMeasure();

      if (typeof ResizeObserver !== "undefined") {
        record.observer = new ResizeObserver(scheduleMeasure);
        record.observer.observe(node);
      }

      record.cleanupImages = observeImageLoads(node, scheduleMeasure);
    },
    [queueMeasurement]
  );

  const attachItemNodeRef = useRef(attachItemNode);
  attachItemNodeRef.current = attachItemNode;

  const measureRef = useCallback((index: number, key: VirtualItemKey) => {
    itemIndicesRef.current.set(key, index);
    let callback = measureCallbacksRef.current.get(key);
    if (!callback) {
      callback = (node) => attachItemNodeRef.current(key, node);
      measureCallbacksRef.current.set(key, callback);
    }
    return callback;
  }, []);

  useIsomorphicLayoutEffect(() => {
    const activeKeys = new Set(itemKeys);
    for (const key of measureCallbacksRef.current.keys()) {
      if (!activeKeys.has(key)) {
        measureCallbacksRef.current.delete(key);
        itemIndicesRef.current.delete(key);
      }
    }
  }, [itemKeys]);

  useIsomorphicLayoutEffect(
    () => () => {
      for (const record of itemObserversRef.current.values()) {
        cleanupItemObserver(record);
      }

      itemObserversRef.current.clear();
      itemIndicesRef.current.clear();
      measureCallbacksRef.current.clear();
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
      viewport.dynamicOverscanBeforePx,
      viewport.dynamicOverscanAfterPx,
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
  latestRenderedBoundsRef.current = getRenderedBounds(range);
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
      const previousAnchorRecord = listChanged
        ? anchorSnapshotRef.current
        : pendingMeasureAnchorSnapshotRef.current ?? anchorSnapshotRef.current;
      pendingMeasureAnchorSnapshotRef.current = null;

      if (previousAnchorRecord) {
        const previousAnchor = previousAnchorRecord.snapshot;
        const anchorIsCurrent =
          previousAnchorRecord.scrollRevision === scrollRevisionRef.current &&
          !isScrollingRef.current &&
          !hasActiveTextSelection(node);

        if (bottomIntentRef.current) {
          nextOffset = Math.max(0, totalSize - metrics.viewportSize);
        } else if (anchorIsCurrent && stickToBottom && previousAnchor.atEnd) {
          nextOffset = Math.max(0, totalSize - metrics.viewportSize);
        } else if (anchorIsCurrent && preserveScrollPosition) {
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
    previousListIdentityRef.current = listIdentity;

    if (nextOffset !== undefined) {
      const boundedOffset = clamp(
        nextOffset,
        0,
        Math.max(0, totalSize - metrics.viewportSize)
      );

      if (Math.abs(metrics.scrollOffset - boundedOffset) > 0.5) {
        scrollRevisionRef.current += 1;
        setNodeScrollOffset(node, axis, boundedOffset, "auto");
      }
    }

    const nextMetrics = getScrollMetrics(node, axis);
    setViewport((previous) =>
      previous.scrollOffset === nextMetrics.scrollOffset &&
      previous.viewportSize === nextMetrics.viewportSize &&
      previous.dynamicOverscanBeforePx === 0 &&
      previous.dynamicOverscanAfterPx === 0
        ? previous
        : {
            ...nextMetrics,
            dynamicOverscanBeforePx: 0,
            dynamicOverscanAfterPx: 0
          }
    );
    const nextAnchor = createAnchorSnapshot(
      virtualizer,
      nextMetrics,
      edgeThreshold,
      bottomThreshold
    );
    anchorSnapshotRef.current = nextAnchor
      ? {
          snapshot: nextAnchor,
          scrollRevision: scrollRevisionRef.current
        }
      : null;
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

    const nextAnchor = createAnchorSnapshot(
      virtualizer,
      getScrollMetrics(node, axis),
      edgeThreshold,
      bottomThreshold
    );
    anchorSnapshotRef.current = nextAnchor
      ? {
          snapshot: nextAnchor,
          scrollRevision: scrollRevisionRef.current
        }
      : null;
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

  const applyScrollOffset = useCallback(
    (
      offset: number,
      behavior: ScrollBehavior,
      preserveBottomIntent: boolean
    ) => {
      const node = containerRef.current;
      if (!node) {
        return;
      }

      if (!preserveBottomIntent) {
        bottomIntentRef.current = false;
      }
      scrollRevisionRef.current += 1;
      pendingMeasureAnchorSnapshotRef.current = null;
      setNodeScrollOffset(node, axis, offset, behavior);
      setViewport({
        ...getScrollMetrics(node, axis),
        dynamicOverscanBeforePx: 0,
        dynamicOverscanAfterPx: 0
      });
    },
    [axis]
  );

  const scrollToOffset = useCallback(
    (offset: number, behavior: ScrollBehavior = "auto") => {
      applyScrollOffset(offset, behavior, false);
    },
    [applyScrollOffset]
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
      bottomIntentRef.current = true;
      applyScrollOffset(
        Math.max(0, totalSize - metrics.viewportSize),
        behavior,
        true
      );
    },
    [applyScrollOffset, axis, totalSize]
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

const EMPTY_DYNAMIC_OVERSCAN: DynamicOverscan = { before: 0, after: 0 };

function getDynamicOverscan(
  previous: ScrollSample | null,
  next: { scrollOffset: number; viewportSize: number },
  timestamp: number
): DynamicOverscan {
  if (!previous || next.viewportSize <= 0) {
    return EMPTY_DYNAMIC_OVERSCAN;
  }

  const delta = next.scrollOffset - previous.scrollOffset;
  const elapsed = Math.max(1, timestamp - previous.timestamp);
  const pixelsPerFrame = (Math.abs(delta) / elapsed) * 16;

  if (pixelsPerFrame < next.viewportSize * 0.25) {
    return EMPTY_DYNAMIC_OVERSCAN;
  }

  const forwardBuffer = Math.min(
    next.viewportSize * 3,
    Math.abs(delta) * 2
  );
  return delta < 0
    ? { before: forwardBuffer, after: 0 }
    : { before: 0, after: forwardBuffer };
}

function isOutsideRenderedBounds(
  metrics: { scrollOffset: number; viewportSize: number },
  bounds: RenderedBounds | null
): boolean {
  return Boolean(
    !bounds ||
      metrics.scrollOffset < bounds.start ||
      metrics.scrollOffset + metrics.viewportSize > bounds.end
  );
}

function getRenderedBounds(
  range: VirtualRange<VirtualItemKey>
): RenderedBounds | null {
  const first = range.items[0];
  const last = range.items[range.items.length - 1];
  return first && last ? { start: first.start, end: last.end } : null;
}

function shouldCallReach(
  previous: ReachRecord | null,
  edgeKey: VirtualItemKey,
  callback?: () => void
): boolean {
  return Boolean(
    callback &&
      (!previous ||
        previous.edgeKey !== edgeKey ||
        previous.callback !== callback)
  );
}

function areKeySequencesEqual(
  previous: readonly VirtualItemKey[],
  next: readonly VirtualItemKey[]
): boolean {
  return (
    previous.length === next.length &&
    previous.every((key, index) => key === next[index])
  );
}

function areEstimateSignaturesEqual(
  previous: readonly number[] | number,
  next: readonly number[] | number
): boolean {
  if (typeof previous === "number" || typeof next === "number") {
    return previous === next;
  }

  return (
    previous.length === next.length &&
    previous.every((size, index) => Object.is(size, next[index]))
  );
}

function isScrollIntentKey(event: KeyboardEvent): boolean {
  return [
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "PageUp",
    "PageDown",
    "Home",
    "End",
    " "
  ].includes(event.key);
}

function hasActiveTextSelection(node: HTMLElement): boolean {
  if (typeof window === "undefined" || !window.getSelection) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  return node.contains(range.commonAncestorContainer);
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
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
