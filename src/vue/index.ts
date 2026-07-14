import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  unref,
  watch
} from "vue";
import type {
  CSSProperties,
  ComponentPublicInstance,
  ComputedRef,
  MaybeRef,
  PropType,
  Ref,
  StyleValue,
} from "vue";
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

export type VueEstimateSize<TItem> =
  | number
  | ((index: number, item: TItem) => number);

/**
 * Options for Vue `useVirtualList`.
 *
 * 用法示例：
 *
 * ```ts
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
  /** Full data array to virtualize. Accepts a plain value, ref, or computed. 要虚拟滚动渲染的完整数据数组，支持普通值、ref 或 computed。 */
  items: MaybeRef<readonly TItem[]>;
  /** Estimated item size before the real DOM size is measured. DOM 真实尺寸测量前使用的预估 item 尺寸。 */
  estimateSize: MaybeRef<VueEstimateSize<TItem>>;
  /** Extra item count rendered before and after the visible range. Defaults to 2. 可视区域前后额外渲染的 item 数量，默认 2。 */
  overscan?: MaybeRef<number | undefined>;
  /** Extra pixel buffer rendered before and after the visible range. 可视区域前后额外渲染的像素缓冲。 */
  overscanPx?: MaybeRef<number | undefined>;
  /** Space in pixels between adjacent items. Defaults to 0. 相邻 item 之间的像素间距，默认 0。 */
  gap?: MaybeRef<number | undefined>;
  /** Render and scroll on the horizontal axis instead of vertical. 是否使用横向虚拟滚动，默认纵向。 */
  horizontal?: MaybeRef<boolean | undefined>;
  /** Stable key resolver used to keep measurements and scroll anchors attached to the same item. 稳定 key 生成函数，用来把测量结果和滚动锚点绑定到同一条数据。 */
  getItemKey?: MaybeRef<
    ((item: TItem, index: number) => VirtualItemKey) | undefined
  >;
  /** Keep the current visible content anchored when items are prepended or measured sizes change. Defaults to true. prepend 数据或 item 高度变化时保持当前可见内容位置，默认 true。 */
  preserveScrollPosition?: MaybeRef<boolean | undefined>;
  /** Scroll to the bottom after the first non-empty render. 首次有数据渲染后自动滚动到底部，适合聊天记录。 */
  initialScrollToBottom?: MaybeRef<boolean | undefined>;
  /** Keep the list pinned to the bottom when it is already near the bottom and content changes. 当前已经接近底部时，新增内容或高度变化后继续贴底。 */
  stickToBottom?: MaybeRef<boolean | undefined>;
  /** Distance in pixels from the bottom that still counts as being at the bottom. Defaults to 24. 距离底部多少像素内仍认为处于底部，默认 24。 */
  bottomThreshold?: MaybeRef<number | undefined>;
  /** Distance in pixels from either edge used to trigger reach callbacks. Defaults to 0. 距离顶部或底部多少像素时触发边缘回调，默认 0。 */
  edgeThreshold?: MaybeRef<number | undefined>;
  /** Called when scrolling reaches the start edge within edgeThreshold. 滚动到起始边缘附近时触发，常用于加载更早数据。 */
  onReachStart?: MaybeRef<(() => void) | undefined>;
  /** Called when scrolling reaches the end edge within edgeThreshold. 滚动到结束边缘附近时触发，常用于加载更新数据。 */
  onReachEnd?: MaybeRef<(() => void) | undefined>;
}

export interface VueVirtualItem<TItem> extends VirtualItem<VirtualItemKey> {
  item: TItem;
  style: CSSProperties;
}

export interface UseVirtualListReturn<TItem> {
  containerRef: Ref<HTMLElement | null>;
  virtualItems: ComputedRef<Array<VueVirtualItem<TItem>>>;
  range: ComputedRef<VirtualRange<VirtualItemKey>>;
  totalSize: ComputedRef<number>;
  innerStyle: ComputedRef<CSSProperties>;
  measureElement: (
    index: number,
    element: Element | ComponentPublicInstance | null,
    key?: VirtualItemKey
  ) => void;
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

export interface VirtualListSlotContext<TItem> {
  item: TItem;
  index: number;
  virtualItem: VueVirtualItem<TItem>;
}

export const VirtualList = defineComponent({
  name: "VirtualList",
  inheritAttrs: false,
  props: {
    items: {
      type: Array as PropType<readonly unknown[]>,
      required: true
    },
    estimateSize: {
      type: [Number, Function] as PropType<VueEstimateSize<unknown>>,
      required: true
    },
    overscan: Number,
    overscanPx: Number,
    gap: Number,
    horizontal: Boolean,
    preserveScrollPosition: {
      type: Boolean,
      default: undefined
    },
    initialScrollToBottom: Boolean,
    stickToBottom: Boolean,
    bottomThreshold: Number,
    edgeThreshold: Number,
    onReachStart: Function as PropType<() => void>,
    onReachEnd: Function as PropType<() => void>,
    getItemKey: Function as PropType<
      (item: unknown, index: number) => VirtualItemKey
    >,
    innerClass: [String, Array, Object] as PropType<unknown>,
    innerStyle: [String, Array, Object] as PropType<StyleValue>,
    itemClass: [String, Array, Object, Function] as PropType<
      | unknown
      | ((
          context: VirtualListSlotContext<unknown>
        ) => unknown)
    >,
    itemStyle: [String, Array, Object, Function] as PropType<
      | StyleValue
      | ((
          context: VirtualListSlotContext<unknown>
        ) => StyleValue | undefined)
    >,
    role: {
      type: String,
      default: "list"
    },
    tabindex: [String, Number] as PropType<string | number>
  },
  setup(props, { attrs, slots }) {
    const virtualList = useVirtualList<unknown>({
      items: computed(() => props.items),
      estimateSize: computed(() => props.estimateSize),
      overscan: computed(() => props.overscan),
      overscanPx: computed(() => props.overscanPx),
      gap: computed(() => props.gap),
      horizontal: computed(() => props.horizontal),
      getItemKey: computed(() => props.getItemKey),
      preserveScrollPosition: computed(() => props.preserveScrollPosition),
      initialScrollToBottom: computed(() => props.initialScrollToBottom),
      stickToBottom: computed(() => props.stickToBottom),
      bottomThreshold: computed(() => props.bottomThreshold),
      edgeThreshold: computed(() => props.edgeThreshold),
      onReachStart: computed(() => props.onReachStart),
      onReachEnd: computed(() => props.onReachEnd)
    });
    const axis = computed<Axis>(() =>
      props.horizontal ? "horizontal" : "vertical"
    );
    const itemIndices = new Map<VirtualItemKey, number>();
    const itemRefCallbacks = new Map<
      VirtualItemKey,
      (element: Element | ComponentPublicInstance | null) => void
    >();
    const getItemRef = (index: number, key: VirtualItemKey) => {
      itemIndices.set(key, index);
      let callback = itemRefCallbacks.get(key);
      if (!callback) {
        callback = (element) =>
          virtualList.measureElement(
            itemIndices.get(key) ?? index,
            element,
            key
          );
        itemRefCallbacks.set(key, callback);
      }
      return callback;
    };

    return () => {
      const renderedItems = virtualList.virtualItems.value;
      const renderedKeys = new Set(renderedItems.map((item) => item.key));
      for (const key of itemRefCallbacks.keys()) {
        if (!renderedKeys.has(key)) {
          itemRefCallbacks.delete(key);
          itemIndices.delete(key);
        }
      }

      return h(
        "div",
        {
          ...attrs,
          ref: virtualList.containerRef,
          role: props.role,
          tabindex: props.tabindex,
          style: [getContainerStyle(axis.value), attrs.style as StyleValue]
        },
        [
          h(
            "div",
            {
              class: props.innerClass,
              style: [virtualList.innerStyle.value, props.innerStyle]
            },
            renderedItems.map((virtualItem) => {
              const context = {
                item: virtualItem.item,
                index: virtualItem.index,
                virtualItem
              };
              const classValue =
                typeof props.itemClass === "function"
                  ? props.itemClass(context)
                  : props.itemClass;
              const styleValue =
                typeof props.itemStyle === "function"
                  ? props.itemStyle(context)
                  : props.itemStyle;

              const children = slots.default?.(context);

              return h(
                "div",
                {
                  key: virtualItem.key,
                  ref: getItemRef(virtualItem.index, virtualItem.key),
                  class: classValue,
                  role: props.role === "list" ? "listitem" : undefined,
                  style: [virtualItem.style, styleValue]
                },
                children && children.length > 0
                  ? children
                  : String(virtualItem.index)
              );
            })
          )
        ]
      );
    };
  }
});

export function useVirtualList<TItem>(
  options: UseVirtualListOptions<TItem>
): UseVirtualListReturn<TItem> {
  const containerRef = ref<HTMLElement | null>(null);
  const viewport = ref({
    scrollOffset: 0,
    viewportSize: 0,
    dynamicOverscanBeforePx: 0,
    dynamicOverscanAfterPx: 0
  });
  const measurementVersion = ref(0);
  const axis = computed<Axis>(() =>
    resolveMaybeRef(options.horizontal) ? "horizontal" : "vertical"
  );
  const defaultGetItemKey = createDefaultGetItemKey<TItem>();
  const itemKeys = computed(() => {
    const items = unref(options.items);
    const getItemKey =
      resolveMaybeRef(options.getItemKey) ?? defaultGetItemKey;
    return items.map((item, index) => getItemKey(item, index));
  });
  let previousKeySequence = itemKeys.value;
  let listRevision = 0;
  const listIdentity = computed(() => {
    const nextKeys = itemKeys.value;
    if (!areKeySequencesEqual(previousKeySequence, nextKeys)) {
      previousKeySequence = nextKeys;
      listRevision += 1;
    }
    return listRevision;
  });
  const estimateSignature = computed<readonly number[] | number>(() => {
    const estimateSize = unref(options.estimateSize);
    if (typeof estimateSize === "number") {
      return estimateSize;
    }
    return unref(options.items).map((item, index) =>
      estimateSize(index, item)
    );
  });
  const coreEstimateSize: EstimateSize = (index) => {
    const signature = estimateSignature.value;
    return typeof signature === "number" ? signature : signature[index] ?? 0;
  };
  const coreGetItemKey = (index: number): VirtualItemKey =>
    itemKeys.value[index] ?? index;
  const virtualizer = shallowRef(
    new Virtualizer<VirtualItemKey>({
      count: unref(options.items).length,
      estimateSize: coreEstimateSize,
      overscan: resolveMaybeRef(options.overscan),
      overscanPx: resolveMaybeRef(options.overscanPx),
      gap: resolveMaybeRef(options.gap),
      getItemKey: coreGetItemKey
    })
  );
  const itemObservers = new Map<VirtualItemKey, ItemObserverRecord>();
  const itemIndices = new Map<VirtualItemKey, number>();
  let anchorSnapshot: RevisionedAnchorSnapshot | null = null;
  let pendingMeasureAnchorSnapshot: RevisionedAnchorSnapshot | null = null;
  let previousListIdentity = listIdentity.value;
  let initialScrollDone = false;
  let bottomIntent = false;
  let lastReachStart: ReachRecord | null = null;
  let lastReachEnd: ReachRecord | null = null;
  let lastScrollSample: ScrollSample | null = null;
  let latestRenderedBounds: RenderedBounds | null = null;
  let scrollRevision = 0;
  let isScrolling = false;
  let internalScrollAdjustment: number | null = null;
  let measureFrame = 0;
  const dirtyMeasurements = new Map<VirtualItemKey, ItemObserverRecord>();
  let previousLayoutIdentity = listIdentity.value;
  let previousEstimateSignature = estimateSignature.value;

  const updateOptions = () => {
    const nextLayoutIdentity = listIdentity.value;
    const nextEstimateSignature = estimateSignature.value;
    if (
      previousLayoutIdentity !== nextLayoutIdentity ||
      !areEstimateSignaturesEqual(
        previousEstimateSignature,
        nextEstimateSignature
      )
    ) {
      virtualizer.value.invalidateLayout();
      previousLayoutIdentity = nextLayoutIdentity;
      previousEstimateSignature = nextEstimateSignature;
    }

    const overscanPx = Math.max(0, resolveMaybeRef(options.overscanPx) ?? 0);
    virtualizer.value.updateOptions({
      count: unref(options.items).length,
      estimateSize: coreEstimateSize,
      overscan: resolveMaybeRef(options.overscan),
      overscanPx,
      overscanBeforePx:
        overscanPx + viewport.value.dynamicOverscanBeforePx,
      overscanAfterPx: overscanPx + viewport.value.dynamicOverscanAfterPx,
      gap: resolveMaybeRef(options.gap),
      getItemKey: coreGetItemKey
    });
  };

  const readViewport = (source: "scroll" | "layout" = "layout") => {
    const node = containerRef.value;
    if (!node) {
      return;
    }

    const nextViewport = getScrollMetrics(node, axis.value);
    const timestamp = now();
    const dynamicOverscan =
      source === "scroll"
        ? getDynamicOverscan(lastScrollSample, nextViewport, timestamp)
        : EMPTY_DYNAMIC_OVERSCAN;
    if (source === "scroll") {
      lastScrollSample = { ...nextViewport, timestamp };
    }

    if (
      viewport.value.scrollOffset !== nextViewport.scrollOffset ||
      viewport.value.viewportSize !== nextViewport.viewportSize ||
      viewport.value.dynamicOverscanBeforePx !== dynamicOverscan.before ||
      viewport.value.dynamicOverscanAfterPx !== dynamicOverscan.after
    ) {
      viewport.value = {
        ...nextViewport,
        dynamicOverscanBeforePx: dynamicOverscan.before,
        dynamicOverscanAfterPx: dynamicOverscan.after
      };
    }
  };

  let viewportFrame = 0;
  const scheduleViewportRead = () => {
    if (typeof window === "undefined" || viewportFrame !== 0) {
      return;
    }

    viewportFrame = window.requestAnimationFrame(() => {
      viewportFrame = 0;
      readViewport();
    });
  };

  let cleanup: (() => void) | undefined;

  onMounted(() => {
    const node = containerRef.value;
    if (!node) {
      return;
    }

    readViewport();
    let scrollFrame = 0;
    let scrollTimer = 0;
    const scheduleScrollRead = () => {
      const nextMetrics = getScrollMetrics(node, axis.value);
      if (
        internalScrollAdjustment !== null &&
        Math.abs(nextMetrics.scrollOffset - internalScrollAdjustment) <= 0.5
      ) {
        internalScrollAdjustment = null;
        readViewport();
        return;
      }
      internalScrollAdjustment = null;

      scrollRevision += 1;
      if (!isScrolling) {
        lastScrollSample = null;
      }
      isScrolling = true;
      node.classList.add("is-scrolling", "inscro-is-scrolling");
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        isScrolling = false;
        lastScrollSample = null;
        node.classList.remove("is-scrolling", "inscro-is-scrolling");
        readViewport();
      }, 120);

      if (isOutsideRenderedBounds(nextMetrics, latestRenderedBounds)) {
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
      bottomIntent = false;
      scrollRevision += 1;
      if (anchorSnapshot) {
        anchorSnapshot = { ...anchorSnapshot, scrollRevision };
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

    cleanup = () => {
      if (viewportFrame !== 0) {
        window.cancelAnimationFrame(viewportFrame);
      }

      if (scrollFrame !== 0) {
        window.cancelAnimationFrame(scrollFrame);
      }

      window.clearTimeout(scrollTimer);
      isScrolling = false;
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
  });

  onBeforeUnmount(() => {
    cleanup?.();
    cleanupItemObservers(itemObservers);
    itemIndices.clear();
    dirtyMeasurements.clear();
    if (measureFrame !== 0 && typeof window !== "undefined") {
      window.cancelAnimationFrame(measureFrame);
      measureFrame = 0;
    }
  });

  watch(axis, () => {
    readViewport();
    measurementVersion.value += 1;
  });

  const range = computed(() => {
    updateOptions();
    measurementVersion.value;
    const nextRange = virtualizer.value.getVirtualRange(
      viewport.value.scrollOffset,
      viewport.value.viewportSize
    );
    latestRenderedBounds = getRenderedBounds(nextRange);
    return nextRange;
  });

  const virtualItems = computed(() => {
    const items = unref(options.items);

    return range.value.items.map((virtualItem) => ({
      ...virtualItem,
      item: items[virtualItem.index] as TItem,
      style: getItemStyle(axis.value, virtualItem)
    }));
  });

  const totalSize = computed(() => range.value.totalSize);
  const innerStyle = computed(() => getInnerStyle(axis.value, totalSize.value));

  watch(
    [
      axis,
      totalSize,
      measurementVersion,
      listIdentity,
      () => resolveMaybeRef(options.initialScrollToBottom),
      () => resolveMaybeRef(options.preserveScrollPosition),
      () => resolveMaybeRef(options.stickToBottom),
      () => resolveMaybeRef(options.bottomThreshold)
    ],
    () => {
      const node = containerRef.value;
      if (!node) {
        return;
      }

      const metrics = getScrollMetrics(node, axis.value);
      if (metrics.viewportSize <= 0) {
        return;
      }

      const shouldInitialScrollToBottom =
        resolveMaybeRef(options.initialScrollToBottom) ?? false;
      const shouldPreserveScrollPosition =
        resolveMaybeRef(options.preserveScrollPosition) ?? true;
      const shouldStickToBottom = resolveMaybeRef(options.stickToBottom) ?? false;
      const threshold = resolveMaybeRef(options.bottomThreshold) ?? 24;
      let nextOffset: number | undefined;

      if (
        shouldInitialScrollToBottom &&
        !initialScrollDone &&
        unref(options.items).length > 0
      ) {
        nextOffset = Math.max(0, totalSize.value - metrics.viewportSize);
        initialScrollDone = true;
        bottomIntent = true;
      } else if (pendingMeasureAnchorSnapshot || anchorSnapshot) {
        const listChanged = previousListIdentity !== listIdentity.value;
        const previousAnchorRecord = listChanged
          ? anchorSnapshot
          : pendingMeasureAnchorSnapshot ?? anchorSnapshot;
        pendingMeasureAnchorSnapshot = null;

        if (previousAnchorRecord) {
          const previousAnchor = previousAnchorRecord.snapshot;
          const anchorIsCurrent =
            previousAnchorRecord.scrollRevision === scrollRevision &&
            !hasActiveTextSelection(node);

          if (bottomIntent) {
            nextOffset = Math.max(0, totalSize.value - metrics.viewportSize);
          } else if (
            anchorIsCurrent &&
            shouldStickToBottom &&
            previousAnchor.atEnd
          ) {
            nextOffset = Math.max(0, totalSize.value - metrics.viewportSize);
          } else if (anchorIsCurrent && shouldPreserveScrollPosition) {
            const nextAnchorIndex = resolveAnchorIndex(
              virtualizer.value,
              previousAnchor
            );

            if (nextAnchorIndex !== -1) {
              nextOffset =
                virtualizer.value.getStartForIndex(nextAnchorIndex) -
                previousAnchor.offset;
            }
          }
        }
      }
      previousListIdentity = listIdentity.value;

      if (nextOffset !== undefined) {
        const boundedOffset = clamp(
          nextOffset,
          0,
          Math.max(0, totalSize.value - metrics.viewportSize)
        );

        if (Math.abs(metrics.scrollOffset - boundedOffset) > 0.5) {
          scrollRevision += 1;
          internalScrollAdjustment = boundedOffset;
          setNodeScrollOffset(node, axis.value, boundedOffset, "auto");
        }
      }

      const nextMetrics = getScrollMetrics(node, axis.value);
      viewport.value = {
        ...nextMetrics,
        dynamicOverscanBeforePx: 0,
        dynamicOverscanAfterPx: 0
      };
      const nextAnchor = createAnchorSnapshot(
        virtualizer.value,
        nextMetrics,
        resolveMaybeRef(options.edgeThreshold) ?? 0,
        threshold
      );
      anchorSnapshot = nextAnchor
        ? { snapshot: nextAnchor, scrollRevision }
        : null;
    },
    { flush: "post" }
  );

  watch(
    () => unref(options.items).length,
    (length) => {
      if (length !== 0) {
        return;
      }

      initialScrollDone = false;
      bottomIntent = false;
      lastReachStart = null;
      lastReachEnd = null;
      anchorSnapshot = null;
      pendingMeasureAnchorSnapshot = null;
      lastScrollSample = null;
    },
    { flush: "post" }
  );

  watch(
    [
      axis,
      () => viewport.value.scrollOffset,
      () => viewport.value.viewportSize,
      () => viewport.value.dynamicOverscanBeforePx,
      () => viewport.value.dynamicOverscanAfterPx,
      totalSize,
      () => resolveMaybeRef(options.bottomThreshold)
    ],
    () => {
      const node = containerRef.value;
      if (!node) {
        return;
      }

      if (previousListIdentity !== listIdentity.value) {
        return;
      }

      const nextAnchor = createAnchorSnapshot(
        virtualizer.value,
        getScrollMetrics(node, axis.value),
        resolveMaybeRef(options.edgeThreshold) ?? 0,
        resolveMaybeRef(options.bottomThreshold) ?? 24
      );
      anchorSnapshot = nextAnchor
        ? { snapshot: nextAnchor, scrollRevision }
        : null;
    },
    { flush: "post" }
  );

  watch(
    [
      () => viewport.value.scrollOffset,
      () => viewport.value.viewportSize,
      totalSize,
      () => resolveMaybeRef(options.edgeThreshold),
      () => resolveMaybeRef(options.initialScrollToBottom),
      () => resolveMaybeRef(options.onReachStart),
      () => resolveMaybeRef(options.onReachEnd),
      listIdentity
    ],
    () => {
      if (
        viewport.value.viewportSize <= 0 ||
        ((resolveMaybeRef(options.initialScrollToBottom) ?? false) &&
          !initialScrollDone)
      ) {
        return;
      }

      const threshold = Math.max(0, resolveMaybeRef(options.edgeThreshold) ?? 0);
      const atStart = viewport.value.scrollOffset <= threshold;
      const atEnd =
        viewport.value.scrollOffset + viewport.value.viewportSize >=
        totalSize.value - threshold;

      const startCallback = resolveMaybeRef(options.onReachStart);
      const endCallback = resolveMaybeRef(options.onReachEnd);
      const keys = itemKeys.value;
      const firstKey = keys[0] ?? "__empty__";
      const lastKey = keys[keys.length - 1] ?? "__empty__";

      if (atStart && shouldCallReach(lastReachStart, firstKey, startCallback)) {
        startCallback?.();
        lastReachStart = { edgeKey: firstKey, callback: startCallback };
      }

      if (atEnd && shouldCallReach(lastReachEnd, lastKey, endCallback)) {
        endCallback?.();
        lastReachEnd = { edgeKey: lastKey, callback: endCallback };
      }

      if (!atStart) {
        lastReachStart = null;
      }

      if (!atEnd) {
        lastReachEnd = null;
      }
    },
    { flush: "post" }
  );

  const flushMeasurements = () => {
    const containerNode = containerRef.value;
    const metrics = containerNode
      ? getScrollMetrics(containerNode, axis.value)
      : null;
    const snapshot =
      containerNode && metrics
        ? createAnchorSnapshot(
            virtualizer.value,
            metrics,
            resolveMaybeRef(options.edgeThreshold) ?? 0,
            resolveMaybeRef(options.bottomThreshold) ?? 24
          )
        : null;
    const previousAnchor = snapshot
      ? { snapshot, scrollRevision }
      : null;

    let changed = false;
    for (const [dirtyKey, dirtyRecord] of dirtyMeasurements) {
      if (itemObservers.get(dirtyKey) !== dirtyRecord) {
        continue;
      }

      const index = itemIndices.get(dirtyKey);
      if (index === undefined) {
        continue;
      }

      const rect = dirtyRecord.node.getBoundingClientRect();
      const size = axis.value === "horizontal" ? rect.width : rect.height;
      changed = virtualizer.value.measure(index, size) || changed;
    }

    dirtyMeasurements.clear();

    if (changed) {
      if (
        previousAnchor &&
        (!pendingMeasureAnchorSnapshot ||
          pendingMeasureAnchorSnapshot.scrollRevision !==
            previousAnchor.scrollRevision)
      ) {
        pendingMeasureAnchorSnapshot = previousAnchor;
      }
      measurementVersion.value += 1;
    }
  };

  const queueMeasurement = (
    key: VirtualItemKey,
    record: ItemObserverRecord
  ) => {
    dirtyMeasurements.set(key, record);
    if (typeof window === "undefined") {
      flushMeasurements();
      return;
    }

    if (measureFrame !== 0) {
      return;
    }

    measureFrame = window.requestAnimationFrame(() => {
      measureFrame = 0;
      flushMeasurements();
    });
  };

  const measureElement = (
    index: number,
    element: Element | ComponentPublicInstance | null,
    keyOverride?: VirtualItemKey
  ) => {
    const node = resolveElement(element);
    const key = keyOverride ?? virtualizer.value.getKeyForIndex(index);
    itemIndices.set(key, index);
    const previousRecord = itemObservers.get(key);

    if (previousRecord?.node === node) {
      return;
    }

    if (previousRecord) {
      cleanupItemObserver(previousRecord);
      itemObservers.delete(key);
    }

    if (!node) {
      itemIndices.delete(key);
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
  };

  const applyScrollOffset = (
    offset: number,
    behavior: ScrollBehavior,
    preserveBottomIntent: boolean
  ) => {
    const node = containerRef.value;
    if (!node) {
      return;
    }

    if (!preserveBottomIntent) {
      bottomIntent = false;
    }
    scrollRevision += 1;
    pendingMeasureAnchorSnapshot = null;
    setNodeScrollOffset(node, axis.value, offset, behavior);
    viewport.value = {
      ...getScrollMetrics(node, axis.value),
      dynamicOverscanBeforePx: 0,
      dynamicOverscanAfterPx: 0
    };
  };

  const scrollToOffset = (
    offset: number,
    behavior: ScrollBehavior = "auto"
  ) => {
    applyScrollOffset(offset, behavior, false);
  };

  const scrollToIndex = (
    index: number,
    align: ScrollToIndexOptions["align"] = "start",
    behavior: ScrollBehavior = "auto"
  ) => {
    const node = containerRef.value;
    if (!node) {
      return;
    }

    const viewportSize =
      axis.value === "horizontal" ? node.clientWidth : node.clientHeight;
    const currentOffset =
      axis.value === "horizontal" ? node.scrollLeft : node.scrollTop;
    const offset = virtualizer.value.getOffsetForIndex(index, {
      align,
      viewportSize,
      currentOffset
    });

    scrollToOffset(offset, behavior);
  };

  const scrollToKey = (
    key: VirtualItemKey,
    align: ScrollToIndexOptions["align"] = "start",
    behavior: ScrollBehavior = "auto"
  ) => {
    const node = containerRef.value;
    if (!node) {
      return;
    }

    const viewportSize =
      axis.value === "horizontal" ? node.clientWidth : node.clientHeight;
    const currentOffset =
      axis.value === "horizontal" ? node.scrollLeft : node.scrollTop;
    const offset = virtualizer.value.getOffsetForKey(key, {
      align,
      viewportSize,
      currentOffset
    });

    if (offset === null) {
      return;
    }

    scrollToOffset(offset, behavior);
  };

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const node = containerRef.value;
    if (!node) {
      return;
    }

    const metrics = getScrollMetrics(node, axis.value);
    bottomIntent = true;
    applyScrollOffset(
      Math.max(0, totalSize.value - metrics.viewportSize),
      behavior,
      true
    );
  };

  const reset = (resetOptions: ResetVirtualListOptions = {}) => {
    virtualizer.value.resetMeasurements();
    anchorSnapshot = null;
    pendingMeasureAnchorSnapshot = null;
    initialScrollDone = false;
    bottomIntent = resetOptions.scrollToBottom ?? false;
    lastReachStart = null;
    lastReachEnd = null;
    lastScrollSample = null;
    measurementVersion.value += 1;

    if (resetOptions.scrollToBottom) {
      scrollToBottom("auto");
    } else {
      readViewport();
    }
  };

  return {
    containerRef,
    virtualItems,
    range,
    totalSize,
    innerStyle,
    measureElement,
    scrollToIndex,
    scrollToKey,
    scrollToOffset,
    scrollToBottom,
    reset
  };
}

function resolveMaybeRef<TValue>(
  value: MaybeRef<TValue> | undefined
): TValue | undefined {
  return value === undefined ? undefined : unref(value);
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

function resolveElement(
  element: Element | ComponentPublicInstance | null
): HTMLElement | null {
  if (!element) {
    return null;
  }

  if (element instanceof HTMLElement) {
    return element;
  }

  if ("$el" in element) {
    const componentElement = element.$el;
    return componentElement instanceof HTMLElement ? componentElement : null;
  }

  return null;
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
      ? { width: `${totalSize}px`, height: "100%" }
      : { height: `${totalSize}px`, width: "100%" })
  };
}

function getItemStyle(
  axis: Axis,
  item: VirtualItem<VirtualItemKey>
): CSSProperties {
  if (axis === "horizontal") {
    return {
      position: "absolute",
      top: "0",
      left: `${item.start}px`,
      height: "100%"
    };
  }

  return {
    position: "absolute",
    top: `${item.start}px`,
    left: "0",
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

function cleanupItemObservers(
  itemObservers: Map<VirtualItemKey, ItemObserverRecord>
): void {
  for (const record of itemObservers.values()) {
    cleanupItemObserver(record);
  }

  itemObservers.clear();
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
