/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  ref as vueRef,
  type App
} from "vue";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  useVirtualList,
  type ReactVirtualItem,
  type UseVirtualListReturn as ReactVirtualListReturn
} from "../src/react";
import { VirtualList as VueVirtualList } from "../src/vue";

interface TestItem {
  id: string;
  height: number;
}

interface ReactHarnessProps {
  items: readonly TestItem[];
  estimateSize: (index: number, item: TestItem) => number;
  tick?: number;
  onReachStart?: () => void;
  onItemMount?: (key: string) => void;
}

let latestReactList: ReactVirtualListReturn<TestItem> | null = null;
const getItemKey = (item: TestItem) => item.id;

function ReactHarness({
  items,
  estimateSize,
  tick = 0,
  onReachStart,
  onItemMount
}: ReactHarnessProps) {
  const list = useVirtualList({
    items,
    estimateSize,
    getItemKey,
    preserveScrollPosition: true,
    edgeThreshold: 0,
    onReachStart
  });
  latestReactList = list;

  return (
    <div
      ref={list.containerRef}
      data-react-list=""
      style={{ height: 100, overflow: "auto" }}
    >
      <div style={list.innerStyle}>
        {list.virtualItems.map((virtualItem) => (
          <ReactHarnessItem
            key={virtualItem.key}
            onItemMount={onItemMount}
            tick={tick}
            virtualItem={virtualItem}
          />
        ))}
      </div>
    </div>
  );
}

function ReactHarnessItem({
  onItemMount,
  tick,
  virtualItem
}: {
  onItemMount?: (key: string) => void;
  tick: number;
  virtualItem: ReactVirtualItem<TestItem>;
}) {
  const ref = React.useCallback(
    (node: HTMLElement | null) => {
      virtualItem.measureRef(node);
      if (node) {
        onItemMount?.(virtualItem.item.id);
      }
    },
    [onItemMount, virtualItem.item.id, virtualItem.measureRef]
  );

  return (
    <div key={virtualItem.key} ref={ref} style={virtualItem.style}>
      <span
        data-height={virtualItem.item.height}
        data-item-key={virtualItem.item.id}
        data-tick={tick}
      >
        {virtualItem.item.id}
      </span>
    </div>
  );
}

class FakeResizeObserver implements ResizeObserver {
  static instances: FakeResizeObserver[] = [];

  readonly observed = new Set<Element>();

  constructor(
    private readonly callback: ResizeObserverCallback
  ) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  static trigger(target: Element): void {
    for (const observer of FakeResizeObserver.instances) {
      if (observer.observed.has(target)) {
        observer.callback([], observer);
      }
    }
  }
}

const originalClientHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientHeight"
);
const originalClientWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientWidth"
);
const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;
const originalScrollTo = HTMLElement.prototype.scrollTo;

let nextAnimationFrame = 1;
let animationFrames = new Map<number, FrameRequestCallback>();

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return readElementSize(this as HTMLElement, "height");
    }
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return readElementSize(this as HTMLElement, "width") || 100;
    }
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    const width = readElementSize(this, "width") || 100;
    const height = readElementSize(this, "height");
    return {
      x: 0,
      y: 0,
      top: 0,
      right: width,
      bottom: height,
      left: 0,
      width,
      height,
      toJSON: () => ({})
    } as DOMRect;
  };
  HTMLElement.prototype.scrollTo = function (
    optionsOrX?: ScrollToOptions | number,
    y?: number
  ) {
    const options =
      typeof optionsOrX === "number"
        ? { left: optionsOrX, top: y ?? 0, behavior: "auto" as const }
        : optionsOrX ?? {};
    const targetTop = options.top ?? this.scrollTop;
    const targetLeft = options.left ?? this.scrollLeft;
    if (options.behavior === "smooth") {
      this.scrollTop += (targetTop - this.scrollTop) / 2;
      this.scrollLeft += (targetLeft - this.scrollLeft) / 2;
    } else {
      this.scrollTop = targetTop;
      this.scrollLeft = targetLeft;
    }
    this.dispatchEvent(new Event("scroll"));
  };
});

afterAll(() => {
  restoreDescriptor(HTMLElement.prototype, "clientHeight", originalClientHeight);
  restoreDescriptor(HTMLElement.prototype, "clientWidth", originalClientWidth);
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  HTMLElement.prototype.scrollTo = originalScrollTo;
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  vi.useFakeTimers();
  FakeResizeObserver.instances = [];
  animationFrames = new Map();
  nextAnimationFrame = 1;
  window.requestAnimationFrame = (callback) => {
    const frame = nextAnimationFrame;
    nextAnimationFrame += 1;
    animationFrames.set(frame, callback);
    return frame;
  };
  window.cancelAnimationFrame = (frame) => {
    animationFrames.delete(frame);
  };
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  latestReactList = null;
  document.body.innerHTML = "";
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("React DOM integration", () => {
  it("keeps layout wrappers and measurement refs stable across rerenders", async () => {
    const items = makeItems(20);
    const estimateSize = vi.fn(() => 20);
    const { root } = await mountReact({ items, estimateSize });
    const estimateCalls = estimateSize.mock.calls.length;
    const observerCount = FakeResizeObserver.instances.length;

    await act(async () => {
      root.render(
        <ReactHarness items={items} estimateSize={estimateSize} tick={1} />
      );
    });
    await flushReactFrames();

    expect(estimateSize).toHaveBeenCalledTimes(estimateCalls);
    expect(FakeResizeObserver.instances).toHaveLength(observerCount);
    await unmountReact(root);
  });

  it("drops a measurement anchor when the user scrolls in the same frame", async () => {
    const items = makeItems(20);
    const { root, container } = await mountReact({
      items,
      estimateSize: () => 20
    });
    await scrollReact(container, 40);

    const firstItem = getItemNode("item-0");
    firstItem.dataset.height = "60";
    FakeResizeObserver.trigger(firstItem.parentElement as HTMLElement);

    await act(async () => {
      flushAnimationFrameBatch();
      container.scrollTop = 80;
      container.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
    });

    expect(container.scrollTop).toBe(80);
    await unmountReact(root);
  });

  it("does not shift content while text inside the list is selected", async () => {
    const items = makeItems(20);
    const { root, container } = await mountReact({
      items,
      estimateSize: () => 20
    });
    await scrollReact(container, 40);

    const selectedItem = getItemNode("item-2");
    const range = document.createRange();
    range.selectNodeContents(selectedItem);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const firstItem = getItemNode("item-0");
    firstItem.dataset.height = "60";
    FakeResizeObserver.trigger(firstItem.parentElement as HTMLElement);
    await flushReactFrames();

    expect(container.scrollTop).toBe(40);
    await unmountReact(root);
  });

  it("preserves the visible item when messages are prepended", async () => {
    const items = makeItems(10);
    const estimateSize = () => 20;
    const { root, container } = await mountReact({ items, estimateSize });
    await scrollReact(container, 40);

    await act(async () => {
      root.render(
        <ReactHarness
          items={[{ id: "prepended", height: 20 }, ...items]}
          estimateSize={estimateSize}
        />
      );
    });
    await flushReactFrames();

    expect(container.scrollTop).toBe(60);
    await unmountReact(root);
  });

  it("preserves the visible item when messages are prepended before scrolling settles", async () => {
    const items = makeItems(10);
    const estimateSize = () => 20;
    const { root, container } = await mountReact({ items, estimateSize });
    await scrollReactActive(container, 40);

    await act(async () => {
      root.render(
        <ReactHarness
          items={[{ id: "prepended", height: 20 }, ...items]}
          estimateSize={estimateSize}
        />
      );
    });
    await flushReactFrames();

    expect(container.scrollTop).toBe(60);
    await unmountReact(root);
  });

  it("does not transiently mount prepended top items before anchor correction", async () => {
    const items = makeItems(10);
    const estimateSize = () => 20;
    const mountedKeys: string[] = [];
    const { root, container } = await mountReact({
      items,
      estimateSize,
      onItemMount: (key) => mountedKeys.push(key)
    });
    await scrollReactActive(container, 40);
    mountedKeys.length = 0;

    await act(async () => {
      root.render(
        <ReactHarness
          items={[{ id: "prepended", height: 20 }, ...items]}
          estimateSize={estimateSize}
          onItemMount={(key) => mountedKeys.push(key)}
        />
      );
    });
    await flushReactFrames();

    expect(container.scrollTop).toBe(60);
    expect(mountedKeys).not.toContain("prepended");
    await unmountReact(root);
  });

  it("preserves the visible item after a fast prepend with mismatched estimated and measured height", async () => {
    const items = makeItems(10, 30);
    const estimateSize = (_index: number, item: TestItem) =>
      item.id === "prepended" ? 20 : 30;
    const { root, container } = await mountReact({ items, estimateSize });
    await scrollReactActive(container, 30);

    await act(async () => {
      root.render(
        <ReactHarness
          items={[{ id: "prepended", height: 50 }, ...items]}
          estimateSize={estimateSize}
        />
      );
    });
    await flushReactFrames();

    expect(container.scrollTop).toBe(80);
    await unmountReact(root);
  });

  it("detects interior key changes even when length and edge keys stay equal", async () => {
    const items = makeItems(5);
    const estimateSize = () => 20;
    const { root } = await mountReact({ items, estimateSize });
    const reordered = [items[0], items[2], items[1], items[3], items[4]] as TestItem[];

    await act(async () => {
      root.render(
        <ReactHarness items={reordered} estimateSize={estimateSize} />
      );
    });
    await flushReactFrames();

    expect(latestReactList?.range.items.map((item) => item.key)).toEqual(
      reordered.map((item) => item.id)
    );
    await unmountReact(root);
  });

  it("retries edge loading when the edge key changes before filling the viewport", async () => {
    const items = makeItems(2);
    const estimateSize = () => 20;
    const onReachStart = vi.fn();
    const { root } = await mountReact({
      items,
      estimateSize,
      onReachStart
    });

    expect(onReachStart).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.render(
        <ReactHarness
          items={[{ id: "older", height: 20 }, ...items]}
          estimateSize={estimateSize}
          onReachStart={onReachStart}
        />
      );
    });
    await flushReactFrames();

    expect(onReachStart).toHaveBeenCalledTimes(2);
    await unmountReact(root);
  });

  it("keeps bottom intent through smooth-scroll frames and async growth", async () => {
    const items = makeItems(10);
    const { root, container } = await mountReact({
      items,
      estimateSize: () => 20
    });

    await act(async () => {
      latestReactList?.scrollToBottom("smooth");
    });
    await flushReactFrames();

    const visibleItem = getItemNode("item-3");
    visibleItem.dataset.height = "60";
    FakeResizeObserver.trigger(visibleItem.parentElement as HTMLElement);
    await flushReactFrames();

    expect(container.scrollTop).toBe(140);
    await unmountReact(root);
  });
});

describe("Vue DOM integration", () => {
  it("keeps layout stable on scroll and preserves anchors after prepend", async () => {
    const items = vueRef(makeItems(20));
    const tick = vueRef(0);
    const estimateSize = vi.fn(() => 20);
    const appRoot = document.createElement("div");
    document.body.append(appRoot);
    const app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(
              VueVirtualList,
              {
                items: items.value,
                estimateSize,
                getItemKey: (item: unknown) => (item as TestItem).id,
                preserveScrollPosition: true,
                style: { height: "100px" },
                "data-vue-list": ""
              },
              {
                default: ({ item }: { item: TestItem }) =>
                  h(
                    "span",
                    {
                      "data-height": item.height,
                      "data-item-key": item.id,
                      "data-tick": tick.value
                    },
                    item.id
                  )
              }
            );
        }
      })
    );
    app.mount(appRoot);
    await flushVueFrames();

    const container = document.querySelector(
      "[data-vue-list]"
    ) as HTMLElement;
    const estimateCalls = estimateSize.mock.calls.length;

    container.scrollTop = 10;
    container.dispatchEvent(new Event("scroll"));
    await flushVueFrames();
    expect(estimateSize).toHaveBeenCalledTimes(estimateCalls);
    const observerCount = FakeResizeObserver.instances.length;

    tick.value += 1;
    await nextTick();
    await flushVueFrames();
    expect(FakeResizeObserver.instances).toHaveLength(observerCount);

    await scrollVue(container, 40);
    items.value = [{ id: "prepended", height: 20 }, ...items.value];
    await nextTick();
    await flushVueFrames();
    expect(container.scrollTop).toBe(60);

    await unmountVue(app);
  });

  it("preserves anchors after fast prepend before scrolling settles", async () => {
    const items = vueRef(makeItems(10));
    const estimateSize = () => 20;
    const appRoot = document.createElement("div");
    document.body.append(appRoot);
    const app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(
              VueVirtualList,
              {
                items: items.value,
                estimateSize,
                getItemKey: (item: unknown) => (item as TestItem).id,
                preserveScrollPosition: true,
                style: { height: "100px" },
                "data-vue-list": ""
              },
              {
                default: ({ item }: { item: TestItem }) =>
                  h(
                    "span",
                    {
                      "data-height": item.height,
                      "data-item-key": item.id
                    },
                    item.id
                  )
              }
            );
        }
      })
    );
    app.mount(appRoot);
    await flushVueFrames();

    const container = document.querySelector(
      "[data-vue-list]"
    ) as HTMLElement;
    await scrollVueActive(container, 40);
    items.value = [{ id: "prepended", height: 20 }, ...items.value];
    await nextTick();
    await flushVueFrames();

    expect(container.scrollTop).toBe(60);
    await unmountVue(app);
  });
});

function makeItems(count: number, height = 20): TestItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `item-${index}`,
    height
  }));
}

async function mountReact(props: ReactHarnessProps): Promise<{
  root: Root;
  container: HTMLElement;
}> {
  const appRoot = document.createElement("div");
  document.body.append(appRoot);
  const root = createRoot(appRoot);
  await act(async () => {
    root.render(<ReactHarness {...props} />);
  });
  await flushReactFrames();
  return {
    root,
    container: document.querySelector("[data-react-list]") as HTMLElement
  };
}

async function unmountReact(root: Root): Promise<void> {
  await act(async () => root.unmount());
}

async function unmountVue(app: App): Promise<void> {
  app.unmount();
  await nextTick();
}

async function scrollReact(
  container: HTMLElement,
  scrollTop: number
): Promise<void> {
  await scrollReactActive(container, scrollTop);
  await act(async () => {
    vi.advanceTimersByTime(121);
  });
  await flushReactFrames();
}

async function scrollReactActive(
  container: HTMLElement,
  scrollTop: number
): Promise<void> {
  await act(async () => {
    container.scrollTop = scrollTop;
    container.dispatchEvent(new Event("scroll"));
  });
  await flushReactFrames();
}

async function scrollVue(
  container: HTMLElement,
  scrollTop: number
): Promise<void> {
  await scrollVueActive(container, scrollTop);
  vi.advanceTimersByTime(121);
  await nextTick();
  await flushVueFrames();
}

async function scrollVueActive(
  container: HTMLElement,
  scrollTop: number
): Promise<void> {
  container.scrollTop = scrollTop;
  container.dispatchEvent(new Event("scroll"));
  await flushVueFrames();
}

async function flushReactFrames(): Promise<void> {
  for (let index = 0; index < 20 && animationFrames.size > 0; index += 1) {
    await act(async () => {
      flushAnimationFrameBatch();
      await Promise.resolve();
    });
  }
}

async function flushVueFrames(): Promise<void> {
  for (let index = 0; index < 20 && animationFrames.size > 0; index += 1) {
    flushAnimationFrameBatch();
    await nextTick();
  }
  await nextTick();
}

function flushAnimationFrameBatch(): void {
  const frames = Array.from(animationFrames.entries());
  animationFrames.clear();
  for (const [, callback] of frames) {
    callback(performance.now());
  }
}

function getItemNode(key: string): HTMLElement {
  return document.querySelector(`[data-item-key="${key}"]`) as HTMLElement;
}

function readElementSize(
  element: HTMLElement,
  dimension: "width" | "height"
): number {
  const ownData = Number(element.dataset[dimension]);
  if (Number.isFinite(ownData) && ownData > 0) {
    return ownData;
  }

  const styleValue = Number.parseFloat(element.style[dimension]);
  if (Number.isFinite(styleValue) && styleValue > 0) {
    return styleValue;
  }

  const child = element.firstElementChild as HTMLElement | null;
  const childData = child ? Number(child.dataset[dimension]) : 0;
  return Number.isFinite(childData) && childData > 0 ? childData : 0;
}

function restoreDescriptor(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  } else {
    Reflect.deleteProperty(target, key);
  }
}
