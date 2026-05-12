<h2 style="display: flex;">
  <img src="./icon.png" alt="inscro icon" width="60" height="60" style="border-radius: 8px; align-self: center;" />
  <span style="font-size: 2em; font-weight: 600; margin-left: 0.25em">inscro</span>
</h2>

一个轻量虚拟列表库，核心算法与框架绑定分离，同时提供 React 和 Vue 3 组件入口。

## Demo

- React demo: [https://aoran997.github.io/inscro/examples/react/](https://aoran997.github.io/inscro/examples/react/)
- Vue demo: [https://aoran997.github.io/inscro/examples/vue/](https://aoran997.github.io/inscro/examples/vue/)

## 特性

- 支持纵向和横向虚拟滚动
- 支持固定尺寸估算和渲染后的动态尺寸测量
- item 内图片或异步内容加载后会自动重新测量尺寸
- 支持 `overscan`、`gap`、自定义 item key
- 同一个 npm 包提供 `inscro/react` 和 `inscro/vue`

## 安装

```bash
npm i inscro
```

React 项目需要安装 `react >= 18`，Vue 项目需要安装 `vue >= 3.3`。

## React 用法

```tsx
import { VirtualList } from "inscro/react";

const items = Array.from({ length: 10000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`
}));

export function Demo() {
  return (
    <VirtualList
      items={items}
      estimateSize={44}
      getItemKey={(item) => item.id}
      overscan={6}
      gap={8}
      style={{ height: 420 }}
      renderItem={({ item }) => (
        <div style={{ padding: "10px 12px", border: "1px solid #ddd" }}>
          {item.title}
        </div>
      )}
    />
  );
}
```

也可以使用 hook：

```ts
import { useVirtualList } from "inscro/react";

function Demo({ items }: { items: string[] }) {
  const list = useVirtualList({ items, estimateSize: 40 });

  return (
    <div ref={list.containerRef} style={{ height: 360, overflow: "auto" }}>
      <div style={list.innerStyle}>
        {list.virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            ref={virtualItem.measureRef}
            style={virtualItem.style}
          >
            {virtualItem.item}
          </div>
        ))}
      </div>
    </div>
  );
}
```

按 item key 跳转到对应内容：

```ts
list.scrollToKey("message-42", "center");
```

## Vue 3 用法

```ts
<script setup lang="ts">
import { VirtualList } from "inscro/vue";

const items = Array.from({ length: 10000 }, (_, index) => ({
  id: index,
  title: `Row ${index}`
}));
</script>

<template>
  <VirtualList
    :items="items"
    :estimate-size="44"
    :get-item-key="(item) => item.id"
    :overscan="6"
    :gap="8"
    style="height: 420px"
  >
    <template #default="{ item }">
      <div style="padding: 10px 12px; border: 1px solid #ddd">
        {{ item.title }}
      </div>
    </template>
  </VirtualList>
</template>
```

组合式 API：

```ts
<script setup lang="ts">
import { useVirtualList } from "inscro/vue";

const items = Array.from({ length: 10000 }, (_, index) => `Row ${index}`);
const { containerRef, innerStyle, virtualItems, measureElement } =
  useVirtualList({ items, estimateSize: 40 });
</script>

<template>
  <div ref="containerRef" style="height: 360px; overflow: auto">
    <div :style="innerStyle">
      <div
        v-for="virtualItem in virtualItems"
        :key="virtualItem.key"
        :ref="(el) => measureElement(virtualItem.index, el)"
        :style="virtualItem.style"
      >
        {{ virtualItem.item }}
      </div>
    </div>
  </div>
</template>
```

## Core 用法

```ts
import { createVirtualizer } from "inscro";

const virtualizer = createVirtualizer({
  count: 10000,
  estimateSize: 40,
  overscan: 4
});

const range = virtualizer.getVirtualRange(800, 400);
console.log(range.items);
```

## API 摘要

React:

- `VirtualList<TItem>(props)`
- `useVirtualList<TItem>(options)`

Vue:

- `VirtualList`
- `useVirtualList<TItem>(options)`

核心：

- `createVirtualizer(options)`
- `new Virtualizer(options)`

常用参数：

- `items`: 数据数组
- `estimateSize`: 数字，或 `(index, item) => number`
- `overscan`: 视口外额外渲染数量，默认 `2`
- `overscanPx`: 视口外额外渲染像素，适合高度差异大或快速滚动的列表
- `gap`: item 间距
- `horizontal`: 是否横向滚动
- `getItemKey`: 自定义 key
- `scrollToKey(key, align?, behavior?)`: 根据 item key 跳转到对应内容，需要配合稳定的 `getItemKey`
- `reset({ scrollToBottom? })`: 清空测量缓存、边缘触发状态和初始滚动状态，切换会话/数据源时使用
- `initialScrollToBottom`: 首次渲染后滚到底部，适合聊天记录
- `stickToBottom`: 用户已经在底部时，新增内容或图片加载后继续贴底
- `preserveScrollPosition`: prepend 数据或上方 item 尺寸变化时保持当前可见内容位置，默认 `true`
- `edgeThreshold`: 距离顶部/底部多少像素触发边缘回调
- `onReachStart`: 滚到顶部附近时触发，可用于加载更早记录
- `onReachEnd`: 滚到底部附近时触发

## 聊天记录和向上加载

聊天记录通常需要从底部开始看，用户向上滚动时 prepend 更早的消息。这个场景建议传稳定的 `getItemKey`，不要用数组 index 当 key，否则 prepend 后图片高度会套到错误的消息上。React/Vue 包装层会在未传 `getItemKey` 时为对象数据按引用生成默认 key，但如果数据是基础类型，或每次请求都会重建旧消息对象，仍然需要传业务 id。

React:

```tsx
const list = useVirtualList({
  items: messages,
  estimateSize: 84,
  getItemKey: (message) => message.id,
  initialScrollToBottom: true,
  stickToBottom: true,
  preserveScrollPosition: true,
  overscanPx: 800,
  edgeThreshold: 120,
  onReachStart: loadOlderMessages
});
```

Vue:

```ts
const list = useVirtualList({
  items: messages,
  estimateSize: 84,
  getItemKey: (message) => message.id,
  initialScrollToBottom: true,
  stickToBottom: true,
  preserveScrollPosition: true,
  overscanPx: 800,
  edgeThreshold: 120,
  onReachStart: loadOlderMessages
});
```

## 用 Pretext 估算文本高度

如果列表 item 主要由多行文本构成，可以用 [`@chenglou/pretext`](https://github.com/chenglou/pretext) 预估文本高度，减少首次渲染后重新测量带来的滚动修正。这个 helper 通过独立子入口提供，只有显式导入时才会进入你的 bundle。

```ts
import { createPretextEstimateSize } from "inscro/pretext";

const estimateSize = createPretextEstimateSize({
  getText: (message) => message.text,
  font: '14px Inter',
  width: 320,
  lineHeight: 22,
  paddingBlock: 24,
  prepareOptions: { whiteSpace: "pre-wrap" },
  fallbackSize: 84
});

const list = useVirtualList({
  items: messages,
  estimateSize,
  getItemKey: (message) => message.id
});
```

Pretext 使用 Canvas 和 `Intl.Segmenter` 做浏览器侧文本测量。SSR 或没有 Canvas 的环境会回退到 `fallbackSize`；如果你使用 webfont，建议在字体加载完成后再依赖它的精确测量结果。

## 图片和异步内容

React 和 Vue 入口都会用 `ResizeObserver` 监听已渲染 item 的尺寸变化。item 内的图片、懒加载内容、折叠展开区域在加载后改变高度时，列表会自动更新测量值，不需要手动调用刷新方法。

建议图片尽量设置 `width`、`height` 或 `aspect-ratio`，这样首屏滚动条更稳定；没有固定尺寸时也能工作，只是图片加载完成时会发生一次正常的滚动空间修正。

## 本地开发

```bash
npm i
npm run test
npm run typecheck
npm run build
```

## 本地 Demo

React demo:

```bash
npm run demo:react
```

打开 [`http://127.0.0.1:5173`](http://127.0.0.1:5173)。

Vue demo:

```bash
npm run demo:vue
```

打开 [`http://127.0.0.1:5174`](http://127.0.0.1:5174)。

## 鸣谢

感谢 [@chenglou/pretext](https://github.com/chenglou/pretext) 提供文本测量能力。
