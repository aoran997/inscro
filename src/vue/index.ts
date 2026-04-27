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

export type VueEstimateSize<TItem> =
  | number
  | ((index: number, item: TItem) => number);

export interface UseVirtualListOptions<TItem> {
  items: MaybeRef<readonly TItem[]>;
  estimateSize: MaybeRef<VueEstimateSize<TItem>>;
  overscan?: MaybeRef<number | undefined>;
  gap?: MaybeRef<number | undefined>;
  horizontal?: MaybeRef<boolean | undefined>;
  getItemKey?: MaybeRef<
    ((item: TItem, index: number) => VirtualItemKey) | undefined
  >;
  preserveScrollPosition?: MaybeRef<boolean | undefined>;
  initialScrollToBottom?: MaybeRef<boolean | undefined>;
  stickToBottom?: MaybeRef<boolean | undefined>;
  bottomThreshold?: MaybeRef<number | undefined>;
  edgeThreshold?: MaybeRef<number | undefined>;
  onReachStart?: MaybeRef<(() => void) | undefined>;
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
  scrollToOffset: (offset: number, behavior?: ScrollBehavior) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
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
    viewportSize: 0
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
  let initialScrollDone = false;
  let reachedStart = false;
  let reachedEnd = false;

  const updateOptions = () => {
    virtualizer.value.updateOptions(
      createVirtualizerOptions(options, defaultGetItemKey)
    );
  };

  const readViewport = () => {
    const node = containerRef.value;
    if (!node) {
      return;
    }

    const nextViewport = getScrollMetrics(node, axis.value);

    if (
      viewport.value.scrollOffset !== nextViewport.scrollOffset ||
      viewport.value.viewportSize !== nextViewport.viewportSize
    ) {
      viewport.value = nextViewport;
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
    node.addEventListener("scroll", scheduleRead, { passive: true });

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

      node.removeEventListener("scroll", scheduleRead);
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
      } else if (anchorSnapshot) {
        if (shouldStickToBottom && anchorSnapshot.atEnd) {
          nextOffset = Math.max(0, totalSize.value - metrics.viewportSize);
        } else if (shouldPreserveScrollPosition) {
          const nextAnchorIndex = resolveAnchorIndex(
            virtualizer.value,
            anchorSnapshot
          );

          if (nextAnchorIndex !== -1) {
            nextOffset =
              virtualizer.value.getStartForIndex(nextAnchorIndex) -
              anchorSnapshot.offset;
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
      viewport.value = nextMetrics;
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
    [
      axis,
      () => viewport.value.scrollOffset,
      () => viewport.value.viewportSize,
      totalSize,
      () => resolveMaybeRef(options.bottomThreshold)
    ],
    () => {
      const node = containerRef.value;
      if (!node) {
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

      if (atStart && !reachedStart) {
        resolveMaybeRef(options.onReachStart)?.();
      }

      if (atEnd && !reachedEnd) {
        resolveMaybeRef(options.onReachEnd)?.();
      }

      reachedStart = atStart;
      reachedEnd = atEnd;
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
      if (virtualizer.value.measure(index, size)) {
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
    viewport.value = getScrollMetrics(node, axis.value);
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

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const node = containerRef.value;
    if (!node) {
      return;
    }

    const metrics = getScrollMetrics(node, axis.value);
    scrollToOffset(Math.max(0, totalSize.value - metrics.viewportSize), behavior);
  };

  return {
    containerRef,
    virtualItems,
    range,
    totalSize,
    innerStyle,
    measureElement,
    scrollToIndex,
    scrollToOffset,
    scrollToBottom
  };
}

function createVirtualizerOptions<TItem>(
  options: UseVirtualListOptions<TItem>,
  defaultGetItemKey: (item: TItem, index: number) => VirtualItemKey
): VirtualizerOptions<VirtualItemKey> {
  const items = unref(options.items);
  const estimateSize = unref(options.estimateSize);
  const getItemKey = resolveMaybeRef(options.getItemKey) ?? defaultGetItemKey;

  return {
    count: items.length,
    estimateSize: createEstimateSize(estimateSize, items),
    overscan: resolveMaybeRef(options.overscan),
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
    overflowAnchor: "none",
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

function setNodeScrollOffset(
  node: HTMLElement,
  axis: Axis,
  offset: number,
  behavior: ScrollBehavior
): void {
  const boundedOffset = Math.max(0, offset);

  if (axis === "horizontal") {
    node.scrollTo({ left: boundedOffset, behavior });
  } else {
    node.scrollTo({ top: boundedOffset, behavior });
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
