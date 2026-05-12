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
  VirtualRange,
  VirtualizerOptions
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

    return () =>
      h(
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
            virtualList.virtualItems.value.map((virtualItem) => {
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
                  ref: (element) =>
                    virtualList.measureElement(
                      virtualItem.index,
                      element,
                      virtualItem.key
                    ),
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
  }
});

export function useVirtualList<TItem>(
  options: UseVirtualListOptions<TItem>
): UseVirtualListReturn<TItem> {
  const containerRef = ref<HTMLElement | null>(null);
  const viewport = ref({
    scrollOffset: 0,
    viewportSize: 0,
    dynamicOverscanPx: 0
  });
  const measurementVersion = ref(0);
  const axis = computed<Axis>(() =>
    resolveMaybeRef(options.horizontal) ? "horizontal" : "vertical"
  );
  const defaultGetItemKey = createDefaultGetItemKey<TItem>();
  const virtualizer = shallowRef(
    new Virtualizer<VirtualItemKey>(
      createVirtualizerOptions(options, defaultGetItemKey)
    )
  );
  const listIdentity = computed(() => {
    const items = unref(options.items);
    const getItemKey =
      resolveMaybeRef(options.getItemKey) ?? defaultGetItemKey;
    const firstKey =
      items.length > 0 ? getItemKey(items[0] as TItem, 0) : "__empty__";
    const lastKey =
      items.length > 0
        ? getItemKey(items[items.length - 1] as TItem, items.length - 1)
        : "__empty__";

    return `${items.length}:${String(firstKey)}:${String(lastKey)}`;
  });
  const itemObservers = new Map<VirtualItemKey, ItemObserverRecord>();
  let anchorSnapshot: ScrollAnchorSnapshot | null = null;
  let pendingMeasureAnchorSnapshot: ScrollAnchorSnapshot | null = null;
  let previousListIdentity = listIdentity.value;
  let initialScrollDone = false;
  let bottomIntent = false;
  let lastReachStart: ReachRecord | null = null;
  let lastReachEnd: ReachRecord | null = null;
  let lastScrollSample: ScrollSample | null = null;
  let latestTotalSize = 0;

  const updateOptions = () => {
    virtualizer.value.updateOptions(
      createVirtualizerOptions(
        options,
        defaultGetItemKey,
        viewport.value.dynamicOverscanPx
      )
    );
  };

  const readViewport = (source: "scroll" | "layout" = "layout") => {
    const node = containerRef.value;
    if (!node) {
      return;
    }

    const nextViewport = getScrollMetrics(node, axis.value);
    const timestamp =
      typeof performance === "undefined" ? Date.now() : performance.now();
    const dynamicOverscanPx =
      source === "scroll"
        ? getDynamicOverscanPx(lastScrollSample, nextViewport, timestamp)
        : 0;
    lastScrollSample = { ...nextViewport, timestamp };

    if (
      source === "scroll" &&
      bottomIntent &&
      !isAtEnd(
        nextViewport,
        latestTotalSize,
        resolveMaybeRef(options.bottomThreshold) ?? 24
      )
    ) {
      bottomIntent = false;
    }

    if (
      viewport.value.scrollOffset !== nextViewport.scrollOffset ||
      viewport.value.viewportSize !== nextViewport.viewportSize ||
      viewport.value.dynamicOverscanPx !== dynamicOverscanPx
    ) {
      viewport.value = { ...nextViewport, dynamicOverscanPx };
    }
  };

  let animationFrame = 0;
  const scheduleRead = () => {
    if (typeof window === "undefined" || animationFrame !== 0) {
      return;
    }

    animationFrame = window.requestAnimationFrame(() => {
      animationFrame = 0;
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
    const handleScroll = () => readViewport("scroll");
    node.addEventListener("scroll", handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleRead);
      resizeObserver.observe(node);
    } else {
      window.addEventListener("resize", scheduleRead);
    }

    cleanup = () => {
      if (animationFrame !== 0) {
        window.cancelAnimationFrame(animationFrame);
      }

      node.removeEventListener("scroll", handleScroll);
      resizeObserver?.disconnect();

      if (typeof ResizeObserver === "undefined") {
        window.removeEventListener("resize", scheduleRead);
      }
    };
  });

  onBeforeUnmount(() => {
    cleanup?.();
    cleanupItemObservers(itemObservers);
  });

  watch(axis, () => {
    readViewport();
    measurementVersion.value += 1;
  });

  const range = computed(() => {
    updateOptions();
    measurementVersion.value;
    return virtualizer.value.getVirtualRange(
      viewport.value.scrollOffset,
      viewport.value.viewportSize
    );
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
  watch(totalSize, (value) => {
    latestTotalSize = value;
  }, { immediate: true });
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
        const previousAnchor = listChanged
          ? anchorSnapshot
          : pendingMeasureAnchorSnapshot ?? anchorSnapshot;
        pendingMeasureAnchorSnapshot = null;
        previousListIdentity = listIdentity.value;

        if (!previousAnchor) {
          return;
        }

        if (bottomIntent || (shouldStickToBottom && previousAnchor.atEnd)) {
          nextOffset = Math.max(0, totalSize.value - metrics.viewportSize);
        } else if (shouldPreserveScrollPosition) {
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

      if (nextOffset !== undefined) {
        const boundedOffset = clamp(
          nextOffset,
          0,
          Math.max(0, totalSize.value - metrics.viewportSize)
        );

        if (Math.abs(metrics.scrollOffset - boundedOffset) > 0.5) {
          setNodeScrollOffset(node, axis.value, boundedOffset, "auto");
        }
      }

      const nextMetrics = getScrollMetrics(node, axis.value);
      viewport.value = { ...nextMetrics, dynamicOverscanPx: 0 };
      anchorSnapshot = createAnchorSnapshot(
        virtualizer.value,
        nextMetrics,
        resolveMaybeRef(options.edgeThreshold) ?? 0,
        threshold
      );
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
      () => viewport.value.dynamicOverscanPx,
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

      anchorSnapshot = createAnchorSnapshot(
        virtualizer.value,
        getScrollMetrics(node, axis.value),
        resolveMaybeRef(options.edgeThreshold) ?? 0,
        resolveMaybeRef(options.bottomThreshold) ?? 24
      );
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
      () => resolveMaybeRef(options.onReachEnd)
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
      const items = unref(options.items);
      const getItemKey =
        resolveMaybeRef(options.getItemKey) ?? defaultGetItemKey;
      const firstKey =
        items.length > 0 ? getItemKey(items[0] as TItem, 0) : "__empty__";
      const lastKey =
        items.length > 0
          ? getItemKey(items[items.length - 1] as TItem, items.length - 1)
          : "__empty__";

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

  const measureElement = (
    index: number,
    element: Element | ComponentPublicInstance | null,
    keyOverride?: VirtualItemKey
  ) => {
    const node = resolveElement(element);
    const key = keyOverride ?? virtualizer.value.getKeyForIndex(index);
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

      const rect = node.getBoundingClientRect();
      const size = axis.value === "horizontal" ? rect.width : rect.height;
      const containerNode = containerRef.value;
      const metrics = containerNode
        ? getScrollMetrics(containerNode, axis.value)
        : null;
      const previousAnchor =
        containerNode && metrics
          ? createAnchorSnapshot(
              virtualizer.value,
              metrics,
              resolveMaybeRef(options.edgeThreshold) ?? 0,
              resolveMaybeRef(options.bottomThreshold) ?? 24
            )
          : null;

      if (virtualizer.value.measure(index, size)) {
        pendingMeasureAnchorSnapshot ??= previousAnchor;
        measurementVersion.value += 1;
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
  };

  const scrollToOffset = (
    offset: number,
    behavior: ScrollBehavior = "auto"
  ) => {
    const node = containerRef.value;
    if (!node) {
      return;
    }

    setNodeScrollOffset(node, axis.value, offset, behavior);
    viewport.value = {
      ...getScrollMetrics(node, axis.value),
      dynamicOverscanPx: 0
    };
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
    scrollToOffset(Math.max(0, totalSize.value - metrics.viewportSize), behavior);
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

function createVirtualizerOptions<TItem>(
  options: UseVirtualListOptions<TItem>,
  defaultGetItemKey: (item: TItem, index: number) => VirtualItemKey,
  dynamicOverscanPx = 0
): VirtualizerOptions<VirtualItemKey> {
  const items = unref(options.items);
  const estimateSize = unref(options.estimateSize);
  const getItemKey = resolveMaybeRef(options.getItemKey) ?? defaultGetItemKey;
  const overscanPx = Math.max(0, resolveMaybeRef(options.overscanPx) ?? 0);

  return {
    count: items.length,
    estimateSize: createEstimateSize(estimateSize, items),
    overscan: resolveMaybeRef(options.overscan),
    overscanPx: overscanPx + dynamicOverscanPx,
    gap: resolveMaybeRef(options.gap),
    getItemKey: (index) => getItemKey(items[index] as TItem, index)
  };
}

function createEstimateSize<TItem>(
  estimateSize: VueEstimateSize<TItem>,
  items: readonly TItem[]
): EstimateSize {
  if (typeof estimateSize === "number") {
    return estimateSize;
  }

  return (index) => estimateSize(index, items[index] as TItem);
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
      ? { width: `${totalSize}px`, height: "100%" }
      : { height: `${totalSize}px`, width: "100%" })
  };
}

function getItemStyle(
  axis: Axis,
  item: VirtualItem<VirtualItemKey>
): CSSProperties {
  return {
    position: "absolute",
    top: "0",
    left: "0",
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

  return Math.min(next.viewportSize * 4, Math.max(next.viewportSize, delta * 2));
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
