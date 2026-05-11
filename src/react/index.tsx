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
  frame: number;
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
    viewportSize: 0
  });
  const virtualizerRef = useRef<Virtualizer<VirtualItemKey>>();
  const itemObserversRef = useRef(new Map<VirtualItemKey, ItemObserverRecord>());
  const anchorSnapshotRef = useRef<ScrollAnchorSnapshot | null>(null);
  const pendingMeasureAnchorSnapshotRef =
    useRef<ScrollAnchorSnapshot | null>(null);
  const previousListIdentityRef = useRef(listIdentity);
  const suppressMeasureAnchorCountRef = useRef(0);
  const initialScrollDoneRef = useRef(false);
  const reachedStartRef = useRef(false);
  const reachedEndRef = useRef(false);

  if (!virtualizerRef.current) {
    virtualizerRef.current = new Virtualizer<VirtualItemKey>({
      count: items.length,
      estimateSize: createEstimateSize(estimateSize, items),
      overscan,
      gap,
      getItemKey: createGetItemKey(resolvedGetItemKey, items)
    });
  }

  const virtualizer = virtualizerRef.current;
  virtualizer.updateOptions({
    count: items.length,
    estimateSize: createEstimateSize(estimateSize, items),
    overscan,
    gap,
    getItemKey: createGetItemKey(resolvedGetItemKey, items)
  });

  const readViewport = useCallback(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const nextViewport = getScrollMetrics(node, axis);

    setViewport((previous) =>
      previous.scrollOffset === nextViewport.scrollOffset &&
      previous.viewportSize === nextViewport.viewportSize
        ? previous
        : nextViewport
    );
  }, [axis]);

  useIsomorphicLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    readViewport();

    let animationFrame = 0;
    const scheduleRead = () => {
      if (animationFrame !== 0) {
        return;
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        readViewport();
      });
    };

    node.addEventListener("scroll", scheduleRead, { passive: true });

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleRead);
      resizeObserver.observe(node);
    } else {
      window.addEventListener("resize", scheduleRead);
    }

    return () => {
      if (animationFrame !== 0) {
        window.cancelAnimationFrame(animationFrame);
      }

      node.removeEventListener("scroll", scheduleRead);
      resizeObserver?.disconnect();

      if (typeof ResizeObserver === "undefined") {
        window.removeEventListener("resize", scheduleRead);
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

      const record: ItemObserverRecord = {
        node,
        index,
        frame: 0
      };

      const measure = () => {
        if (itemObservers.get(key) !== record) {
          return;
        }

        const containerNode = containerRef.current;
        const metrics = containerNode ? getScrollMetrics(containerNode, axis) : null;
        const previousAnchor =
          containerNode && metrics
            ? createAnchorSnapshot(
                virtualizer,
                metrics,
                edgeThreshold,
                bottomThreshold
              )
            : null;
        const rect = node.getBoundingClientRect();
        const size = axis === "horizontal" ? rect.width : rect.height;
        if (virtualizer.measure(index, size)) {
          if (suppressMeasureAnchorCountRef.current === 0) {
            pendingMeasureAnchorSnapshotRef.current = previousAnchor;
          }
          setMeasurementVersion((value) => value + 1);
        }
      };

      const scheduleMeasure = () => {
        if (typeof window === "undefined") {
          measure();
          return;
        }

        if (record.frame !== 0) {
          return;
        }

        record.frame = window.requestAnimationFrame(() => {
          record.frame = 0;
          measure();
        });
      };

      itemObservers.set(key, record);
      measure();

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
      measurementVersion,
      items,
      estimateSize,
      overscan,
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
    } else {
      const listChanged = previousListIdentityRef.current !== listIdentity;
      if (listChanged) {
        suppressMeasureAnchorCountRef.current = 2;
      }
      const previousAnchor = listChanged
        ? anchorSnapshotRef.current
        : pendingMeasureAnchorSnapshotRef.current ?? anchorSnapshotRef.current;
      pendingMeasureAnchorSnapshotRef.current = null;
      previousListIdentityRef.current = listIdentity;

      if (previousAnchor) {
        if (stickToBottom && previousAnchor.atEnd) {
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
      previous.viewportSize === nextMetrics.viewportSize
        ? previous
        : nextMetrics
    );
    anchorSnapshotRef.current = createAnchorSnapshot(
      virtualizer,
      nextMetrics,
      edgeThreshold,
      bottomThreshold
    );

    if (suppressMeasureAnchorCountRef.current > 0) {
      suppressMeasureAnchorCountRef.current -= 1;
    }
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

    if (atStart && !reachedStartRef.current) {
      onReachStart?.();
    }

    if (atEnd && !reachedEndRef.current) {
      onReachEnd?.();
    }

    reachedStartRef.current = atStart;
    reachedEndRef.current = atEnd;
  }, [
    viewport.scrollOffset,
    viewport.viewportSize,
    totalSize,
    edgeThreshold,
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
      setViewport(getScrollMetrics(node, axis));
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

  return {
    containerRef,
    virtualItems,
    range,
    totalSize,
    innerStyle,
    scrollToIndex,
    scrollToKey,
    scrollToOffset,
    scrollToBottom
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
    contain: "strict",
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
  return {
    position: "absolute",
    top: 0,
    left: 0,
    ...(axis === "horizontal"
      ? {
          height: "100%",
          transform: `translateX(${item.start}px)`
        }
      : {
          width: "100%",
          transform: `translateY(${item.start}px)`
        })
  };
}

function getScrollMetrics(node: HTMLElement, axis: Axis) {
  return {
    scrollOffset: axis === "horizontal" ? node.scrollLeft : node.scrollTop,
    viewportSize: axis === "horizontal" ? node.clientWidth : node.clientHeight
  };
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

  if (record.frame !== 0 && typeof window !== "undefined") {
    window.cancelAnimationFrame(record.frame);
  }
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
