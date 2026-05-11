/** @jsxImportSource vue */
import { computed, createApp, defineComponent, nextTick, ref } from 'vue'
import { useVirtualList } from '../../../src/vue'
import type { VueVirtualItem } from '../../../src/vue'
import {
  estimateMessageSize,
  estimateHorizontalMessageSize,
  getScenarioCode,
  getHorizontalMessageSizeClass,
  makeMessages,
  makeRandomMessage,
  pageSize,
  scenarioConfigs,
  totalMessageCount,
} from '../../shared/demo-data'
import type { ChatMessage, Scenario } from '../../shared/demo-data'
import './styles.css'

const iconUrl = new URL('../../../icon.png', import.meta.url).href

const PreText = defineComponent({
  name: 'PreText',
  props: {
    value: {
      type: String,
      required: true,
    },
  },
  setup(props) {
    return () => <pre class="pretext">{props.value}</pre>
  },
})

const MessageRow = defineComponent({
  name: 'MessageRow',
  props: {
    axis: {
      type: String as () => 'horizontal' | 'vertical',
      required: true,
    },
    isFirst: {
      type: Boolean,
      required: true,
    },
    isLast: {
      type: Boolean,
      required: true,
    },
    virtualItem: {
      type: Object as () => VueVirtualItem<ChatMessage>,
      required: true,
    },
    measureElement: {
      type: Function,
      required: true,
    },
  },
  setup(props) {
    return () => {
      const virtualItem = props.virtualItem
      const image = virtualItem.item.image

      return (
        <article
          ref={(element) =>
            props.measureElement(virtualItem.index, element, virtualItem.key)
          }
          class={[
            'message',
            props.axis === 'horizontal' ? 'horizontal-message' : '',
            props.axis === 'horizontal'
              ? getHorizontalMessageSizeClass(virtualItem.item)
              : '',
            props.isFirst ? 'edge-start' : '',
            props.isLast ? 'edge-end' : '',
            virtualItem.item.mine ? 'mine' : '',
          ]}
          style={virtualItem.style}
        >
          <div class="bubble">
            <div class="message-meta">
              <strong>{virtualItem.item.author}</strong>
              <span>#{virtualItem.item.id}</span>
            </div>
            <p>{virtualItem.item.text}</p>
            {image ? (
              <img
                alt={image.alt}
                class="message-image"
                loading="lazy"
                src={image.src}
              />
            ) : null}
            {virtualItem.item.preText ? (
              <PreText value={virtualItem.item.preText} />
            ) : null}
          </div>
        </article>
      )
    }
  },
})

const ChatListScenario = defineComponent({
  name: 'ChatListScenario',
  props: {
    scenario: {
      type: String as () => Scenario,
      required: true,
    },
  },
  setup(props) {
    const config = computed(() => scenarioConfigs[props.scenario])
    const loadedStart = ref(config.value.initialStart)
    const loadedEnd = ref(config.value.initialEnd)
    const insertedMessages = ref<ChatMessage[]>([])
    const loadingOlder = ref(false)
    const loadingNewer = ref(false)
    const showCode = ref(false)
    const insertSeed = ref(1)
    const targetKey = ref(
      `msg-${Math.floor((config.value.initialStart + config.value.initialEnd) / 2) + 1}`,
    )
    const didCenterInitialPosition = ref(false)
    const baseMessages = computed(() =>
      makeMessages(loadedStart.value, loadedEnd.value),
    )
    const messages = computed(() => {
      if (insertedMessages.value.length === 0) {
        return baseMessages.value
      }

      const nextMessages = [...baseMessages.value]
      for (const [index, message] of insertedMessages.value.entries()) {
        const insertAt = Math.min(
          nextMessages.length,
          Math.floor(
            ((index + 1) * nextMessages.length) /
              (insertedMessages.value.length + 1),
          ),
        )
        nextMessages.splice(insertAt, 0, message)
      }
      return nextMessages
    })
    const canLoadOlder = computed(
      () =>
        loadedStart.value > 0 &&
        (props.scenario === 'vertical-prepend' ||
          props.scenario === 'horizontal-prepend'),
    )
    const canLoadNewer = computed(
      () =>
        loadedEnd.value < totalMessageCount &&
        (props.scenario === 'vertical-append' ||
          props.scenario === 'horizontal-append'),
    )

    const loadOlder = () => {
      if (!canLoadOlder.value || loadingOlder.value) {
        return
      }

      loadingOlder.value = true
      window.setTimeout(() => {
        loadedStart.value = Math.max(0, loadedStart.value - pageSize)
        loadingOlder.value = false
      }, 420)
    }

    const loadNewer = () => {
      if (!canLoadNewer.value || loadingNewer.value) {
        return
      }

      loadingNewer.value = true
      window.setTimeout(() => {
        loadedEnd.value = Math.min(
          totalMessageCount,
          loadedEnd.value + pageSize,
        )
        loadingNewer.value = false
      }, 420)
    }

    const insertRandomMessage = () => {
      insertedMessages.value = [
        ...insertedMessages.value,
        makeRandomMessage(insertSeed.value),
      ]
      insertSeed.value += 1
    }

    const list = useVirtualList({
      items: messages,
      estimateSize:
        config.value.axis === 'horizontal'
          ? estimateHorizontalMessageSize
          : estimateMessageSize,
      getItemKey: (message) => message.id,
      gap: 10,
      horizontal: computed(() => config.value.axis === 'horizontal'),
      initialScrollToBottom: computed(
        () => config.value.initialPosition === 'bottom',
      ),
      onReachEnd: computed(() => (canLoadNewer.value ? loadNewer : undefined)),
      onReachStart: computed(() =>
        canLoadOlder.value ? loadOlder : undefined,
      ),
      preserveScrollPosition: true,
      edgeThreshold: 120,
      stickToBottom: computed(
        () =>
          props.scenario === 'vertical-prepend' ||
          props.scenario === 'horizontal-prepend',
      ),
    })
    const scrollToStartPoint = () => {
      if (config.value.initialPosition === 'bottom') {
        list.scrollToBottom()
        return
      }

      if (config.value.initialPosition === 'center') {
        list.scrollToIndex(Math.floor(messages.value.length / 2), 'center')
        return
      }

      list.scrollToOffset(0)
    }
    const scrollToTargetKey = (event: Event) => {
      event.preventDefault()
      const trimmedKey = targetKey.value.trim()
      if (trimmedKey.length === 0) {
        return
      }

      list.scrollToKey(trimmedKey, 'center')
    }
    const rangeText = computed(
      () => `${list.range.value.startIndex}-${list.range.value.endIndex}`,
    )

    nextTick(() => {
      if (
        config.value.initialPosition !== 'center' ||
        didCenterInitialPosition.value
      ) {
        return
      }

      didCenterInitialPosition.value = true
      window.requestAnimationFrame(() => {
        list.scrollToIndex(Math.floor(messages.value.length / 2), 'center')
      })
    })

    return () => (
      <section class="scenario-panel">
        <div class="scenario-toolbar">
          <div>
            <strong>{config.value.title}</strong>
            <span>
              已加载 {messages.value.length} / {totalMessageCount} 条，源范围{' '}
              {loadedStart.value + 1}-{loadedEnd.value}，渲染范围{' '}
              {rangeText.value}
            </span>
          </div>
          <div class="actions">
            <button
              disabled={!canLoadOlder.value || loadingOlder.value}
              onClick={loadOlder}
              type="button"
            >
              {loadingOlder.value ? '加载中' : config.value.loadStartLabel}
            </button>
            <button
              disabled={!canLoadNewer.value || loadingNewer.value}
              onClick={loadNewer}
              type="button"
            >
              {loadingNewer.value ? '加载中' : config.value.loadEndLabel}
            </button>
            <button onClick={insertRandomMessage} type="button">
              随机插入
            </button>
            <button onClick={scrollToStartPoint} type="button">
              回到起点
            </button>
            <form class="key-jump" onSubmit={scrollToTargetKey}>
              <input
                aria-label="item key"
                onInput={(event) => {
                  targetKey.value = (event.target as HTMLInputElement).value
                }}
                placeholder="msg-42"
                value={targetKey.value}
              />
              <button disabled={targetKey.value.trim().length === 0} type="submit">
                跳转 key
              </button>
            </form>
          </div>
        </div>

        <section
          ref={list.containerRef}
          class={[
            'viewport',
            'chat-viewport',
            config.value.axis === 'horizontal' ? 'horizontal-viewport' : '',
          ]}
          aria-label={`${config.value.title} virtual list`}
        >
          <div style={list.innerStyle.value}>
            {list.virtualItems.value.map((virtualItem) => (
              <MessageRow
                axis={config.value.axis}
                isFirst={virtualItem.index === 0}
                isLast={virtualItem.index === messages.value.length - 1}
                key={virtualItem.key}
                measureElement={list.measureElement}
                virtualItem={virtualItem}
              />
            ))}
          </div>
        </section>

        <div class="scenario-footer">
          <button
            class="code-toggle"
            onClick={() => (showCode.value = !showCode.value)}
            type="button"
          >
            {showCode.value ? '隐藏代码' : '显示代码'}
          </button>
        </div>

        {showCode.value ? (
          <pre class="code-panel code-panel-enter">
            <code>{getScenarioCode('Vue', props.scenario)}</code>
          </pre>
        ) : null}
      </section>
    )
  },
})

const App = defineComponent({
  name: 'VueChatDemo',
  setup() {
    return () => (
      <main class="app-shell">
        <header class="toolbar">
          <div class="brand">
            <img src={iconUrl} alt="" aria-hidden="true" />
            <div>
              <h1>Vue 聊天虚拟列表</h1>
              <p>四种列表从上到下同时展示，分别验证纵向和横向的双端加载。</p>
            </div>
          </div>
        </header>

        <section class="scenario-stack">
          {(Object.keys(scenarioConfigs) as Scenario[]).map((scenario) => (
            <ChatListScenario key={scenario} scenario={scenario} />
          ))}
        </section>
      </main>
    )
  },
})

createApp(App).mount('#app')
