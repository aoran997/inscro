import {
  computed,
  createApp,
  defineComponent,
  h,
  ref
} from "vue";
import { useVirtualList } from "../../../src/vue";
import "./styles.css";

interface ChatMessage {
  id: number;
  author: string;
  text: string;
  preText?: string;
  mine: boolean;
}

const authors = ["Alice", "Bruno", "Chen", "Daria"];

function makeMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    const repeat = (index % 4) + 1;

    return {
      id,
      author: authors[index % authors.length],
      text: Array.from(
        { length: repeat },
        () => "这是一条聊天消息，内容长度不固定，用来验证向上加载后的滚动锚点。"
      ).join(" "),
      preText:
        index % 8 === 0
          ? `message_id: ${id}\nauthor: ${authors[index % authors.length]}\nstatus: delivered`
          : undefined,
      mine: index % 3 === 0,
    };
  });
}

const PreText = defineComponent({
  name: "PreText",
  props: {
    value: {
      type: String,
      required: true
    }
  },
  setup(props) {
    return () => h("pre", { class: "pretext" }, props.value);
  }
});

const App = defineComponent({
  name: "VueChatDemo",
  setup() {
    const allMessages = makeMessages(1200);
    const startIndex = ref(allMessages.length - 80);
    const loadingOlder = ref(false);
    const messages = computed(() => allMessages.slice(startIndex.value));

    const loadOlder = () => {
      if (loadingOlder.value || startIndex.value === 0) {
        return;
      }

      loadingOlder.value = true;
      window.setTimeout(() => {
        startIndex.value = Math.max(0, startIndex.value - 40);
        loadingOlder.value = false;
      }, 420);
    };

    const list = useVirtualList({
      items: messages,
      estimateSize: (index, message) =>
        64 + (message.text.length > 70 ? 28 : 0) + (message.preText ? 72 : 0),
      getItemKey: (message) => message.id,
      overscan: 10,
      gap: 10,
      initialScrollToBottom: true,
      stickToBottom: true,
      preserveScrollPosition: true,
      edgeThreshold: 120,
      onReachStart: loadOlder
    });
    const rangeText = computed(
      () => `${list.range.value.startIndex}-${list.range.value.endIndex}`
    );

    return () =>
      h("main", { class: "app-shell" }, [
        h("header", { class: "toolbar" }, [
          h("div", null, [
            h("h1", null, "Vue 聊天虚拟列表"),
            h(
              "p",
              null,
              `已加载 ${messages.value.length} / ${allMessages.length} 条，范围 ${rangeText.value}`
            )
          ]),
          h("div", { class: "actions" }, [
            h(
              "button",
              {
                type: "button",
                disabled: loadingOlder.value || startIndex.value === 0,
                onClick: loadOlder
              },
              loadingOlder.value ? "加载中" : "加载更早"
            ),
            h(
              "button",
              { type: "button", onClick: () => list.scrollToBottom() },
              "回到底部"
            )
          ])
        ]),
        h(
          "section",
          {
            ref: list.containerRef,
            class: "viewport chat-viewport",
            "aria-label": "Vue chat virtual list"
          },
          [
            h(
              "div",
              { style: list.innerStyle.value },
              list.virtualItems.value.map((virtualItem) =>
                h(
                  "article",
                  {
                    key: virtualItem.key,
                    ref: (element) =>
                      list.measureElement(
                        virtualItem.index,
                        element,
                        virtualItem.key
                      ),
                    class: ["message", virtualItem.item.mine ? "mine" : ""],
                    style: virtualItem.style
                  },
                  [
                    h("div", { class: "bubble" }, [
                      h("div", { class: "message-meta" }, [
                        h("strong", null, virtualItem.item.author),
                        h("span", null, `#${virtualItem.item.id}`)
                      ]),
                      h("p", null, virtualItem.item.text),
                      virtualItem.item.preText
                        ? h(PreText, { value: virtualItem.item.preText })
                        : null
                    ])
                  ]
                )
              )
            )
          ]
        )
      ]);
  }
});

createApp(App).mount("#app");
