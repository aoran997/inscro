export type Scenario =
  | "vertical-prepend"
  | "vertical-append"
  | "horizontal-append"
  | "horizontal-prepend";

export interface ChatMessage {
  id: string;
  author: string;
  text: string;
  image?: {
    alt: string;
    src: string;
  };
  preText?: string;
  mine: boolean;
  repeat: number;
}

export interface ScenarioConfig {
  axis: "horizontal" | "vertical";
  description: string;
  initialEnd: number;
  initialStart: number;
  initialPosition: "bottom" | "center" | "top";
  loadEndLabel: string;
  loadStartLabel: string;
  title: string;
}

const authors = ["Alice", "Bruno", "Chen", "Daria"];

export const totalMessageCount = 1200;
export const pageSize = 40;
export const initialWindowSize = 80;
export const unknownImagePlaceholderHeight = 280;

export const scenarioConfigs: Record<Scenario, ScenarioConfig> = {
  "vertical-prepend": {
    axis: "vertical",
    description: "滚到顶部触发 prepend，更早消息插入到列表前面。",
    initialEnd: totalMessageCount,
    initialPosition: "bottom",
    initialStart: totalMessageCount - initialWindowSize,
    loadEndLabel: "加载更新",
    loadStartLabel: "加载更早",
    title: "纵向向上加载"
  },
  "vertical-append": {
    axis: "vertical",
    description: "滚到底部触发 append，新消息插入到列表后面。",
    initialEnd: initialWindowSize,
    initialPosition: "top",
    initialStart: 0,
    loadEndLabel: "加载更新",
    loadStartLabel: "加载更早",
    title: "纵向向下加载"
  },
  "horizontal-append": {
    axis: "horizontal",
    description: "横向从左往右滚动，滚到右侧触发 append。",
    initialEnd: initialWindowSize,
    initialPosition: "top",
    initialStart: 0,
    loadEndLabel: "加载右侧",
    loadStartLabel: "加载左侧",
    title: "横向向右加载"
  },
  "horizontal-prepend": {
    axis: "horizontal",
    description: "横向从右侧开始，滚到左侧触发 prepend。",
    initialEnd: totalMessageCount,
    initialPosition: "bottom",
    initialStart: totalMessageCount - initialWindowSize,
    loadEndLabel: "加载右侧",
    loadStartLabel: "加载左侧",
    title: "横向向左加载"
  }
};

export function makeMessage(index: number): ChatMessage {
  const id = index + 1;
  const repeat = (index % 4) + 1;
  const hasImage = index % 7 === 0;
  const imageWidth = 480;
  const imageHeight = index % 14 === 0 ? 320 : 240;

  return {
    id: `msg-${id}`,
    author: authors[index % authors.length],
    image: hasImage
      ? {
          alt: `message ${id} attachment`,
          src: `https://picsum.photos/seed/inscro-${id}/${imageWidth}/${imageHeight}?delay=${(index % 5) * 240}`
        }
      : undefined,
    text: Array.from(
      { length: repeat },
      () => "这是一条聊天消息，内容长度不固定，用来验证向上加载后的滚动锚点。"
    ).join(" "),
    preText:
      index % 8 === 0
        ? `message_id: ${id}\nauthor: ${authors[index % authors.length]}\nstatus: delivered`
        : undefined,
    mine: index % 3 === 0,
    repeat
  };
}

export function makeRandomMessage(seed: number): ChatMessage {
  const repeat = (seed % 5) + 1;

  return {
    id: `temp-${Date.now()}-${seed}`,
    author: authors[seed % authors.length],
    text: Array.from(
      { length: repeat },
      () => "这是一条临时插入的数据，用来测试列表中间插入后的滚动稳定性。"
    ).join(" "),
    preText:
      seed % 2 === 0
        ? `temporary: true\nclient_seed: ${seed}\nstatus: pending`
        : undefined,
    mine: seed % 3 === 0,
    repeat
  };
}

export function makeMessages(start: number, end: number): ChatMessage[] {
  return Array.from({ length: end - start }, (_, index) =>
    makeMessage(start + index)
  );
}

export function estimateMessageSize(_: number, message: ChatMessage): number {
  return (
    74 +
    (message.repeat - 1) * 24 +
    (message.preText ? 86 : 0) +
    (message.image ? unknownImagePlaceholderHeight + 12 : 0)
  );
}

export function estimateHorizontalMessageSize(
  _: number,
  message: ChatMessage
): number {
  return getHorizontalMessageWidth(message);
}

export function getHorizontalMessageWidth(message: ChatMessage): number {
  if (message.image) {
    return 360;
  }

  if (message.preText) {
    return 330;
  }

  if (message.repeat >= 4) {
    return 320;
  }

  if (message.repeat >= 2) {
    return 280;
  }

  return 240;
}

export function getHorizontalMessageSizeClass(message: ChatMessage): string {
  if (message.image) {
    return "horizontal-card-media";
  }

  if (message.preText) {
    return "horizontal-card-code";
  }

  if (message.repeat >= 4) {
    return "horizontal-card-wide";
  }

  if (message.repeat >= 2) {
    return "horizontal-card-regular";
  }

  return "horizontal-card-compact";
}

export function getScenarioCode(framework: "React" | "Vue", scenario: Scenario): string {
  const config = scenarioConfigs[scenario];
  const hookName = framework === "React" ? "useVirtualList" : "useVirtualList";
  const itemsValue = framework === "React" ? "messages" : "messages";
  const maybeComputed = framework === "React" ? "" : "computed(() => ";
  const maybeComputedClose = framework === "React" ? "" : ")";

  return `const list = ${hookName}({
  items: ${itemsValue},
  estimateSize: ${config.axis === "horizontal" ? "estimateHorizontalMessageSize" : "estimateMessageSize"},
  getItemKey: (message) => message.id,
  horizontal: ${config.axis === "horizontal"},
  gap: 10,
  initialScrollToBottom: ${maybeComputed}${config.initialPosition === "bottom"}${maybeComputedClose},
  preserveScrollPosition: true,
  stickToBottom: ${maybeComputed}${scenario === "vertical-prepend" || scenario === "horizontal-prepend"}${maybeComputedClose},
  edgeThreshold: 120,
  onReachStart: ${config.initialStart > 0 ? "loadOlder" : "undefined"},
  onReachEnd: ${config.initialEnd < totalMessageCount ? "loadNewer" : "undefined"}
});

list.scrollToKey("msg-42", "center");`;
}
