import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useVirtualList } from '../../../src/react'
import type { ReactVirtualItem } from '../../../src/react'
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

function App() {
  return (
    <main className="app-shell">
      <header className="toolbar">
        <div className="brand">
          <img src={iconUrl} alt="" aria-hidden="true" />
          <div>
            <h1>React 聊天虚拟列表</h1>
            <p>四种列表从上到下同时展示，分别验证纵向和横向的双端加载。</p>
          </div>
        </div>
      </header>

      <section className="scenario-stack">
        {(Object.keys(scenarioConfigs) as Scenario[]).map((scenario) => (
          <ChatListScenario key={scenario} scenario={scenario} />
        ))}
      </section>
    </main>
  )
}

function ChatListScenario({ scenario }: { scenario: Scenario }) {
  const config = scenarioConfigs[scenario]
  const [loadedStart, setLoadedStart] = useState(config.initialStart)
  const [loadedEnd, setLoadedEnd] = useState(config.initialEnd)
  const [insertedMessages, setInsertedMessages] = useState<ChatMessage[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const [insertSeed, setInsertSeed] = useState(1)
  const didCenterInitialPositionRef = useRef(false)
  const baseMessages = useMemo(
    () => makeMessages(loadedStart, loadedEnd),
    [loadedEnd, loadedStart],
  )
  const messages = useMemo(() => {
    if (insertedMessages.length === 0) {
      return baseMessages
    }

    const nextMessages = [...baseMessages]
    for (const [index, message] of insertedMessages.entries()) {
      const insertAt = Math.min(
        nextMessages.length,
        Math.floor(((index + 1) * nextMessages.length) / (insertedMessages.length + 1)),
      )
      nextMessages.splice(insertAt, 0, message)
    }
    return nextMessages
  }, [baseMessages, insertedMessages])

  const canLoadOlder =
    loadedStart > 0 &&
    (scenario === 'vertical-prepend' || scenario === 'horizontal-prepend')
  const canLoadNewer =
    loadedEnd < totalMessageCount &&
    (scenario === 'vertical-append' || scenario === 'horizontal-append')

  const loadOlder = useCallback(() => {
    if (!canLoadOlder || loadingOlder) {
      return
    }

    setLoadingOlder(true)
    window.setTimeout(() => {
      setLoadedStart((current) => Math.max(0, current - pageSize))
      setLoadingOlder(false)
    }, 420)
  }, [canLoadOlder, loadingOlder])

  const loadNewer = useCallback(() => {
    if (!canLoadNewer || loadingNewer) {
      return
    }

    setLoadingNewer(true)
    window.setTimeout(() => {
      setLoadedEnd((current) =>
        Math.min(totalMessageCount, current + pageSize),
      )
      setLoadingNewer(false)
    }, 420)
  }, [canLoadNewer, loadingNewer])

  const insertRandomMessage = useCallback(() => {
    setInsertedMessages((current) => [
      ...current,
      makeRandomMessage(insertSeed),
    ])
    setInsertSeed((current) => current + 1)
  }, [insertSeed])

  const list = useVirtualList({
    items: messages,
    estimateSize:
      config.axis === 'horizontal'
        ? estimateHorizontalMessageSize
        : estimateMessageSize,
    getItemKey: (message) => message.id,
    gap: 10,
    horizontal: config.axis === 'horizontal',
    initialScrollToBottom: config.initialPosition === 'bottom',
    onReachEnd: canLoadNewer ? loadNewer : undefined,
    onReachStart: canLoadOlder ? loadOlder : undefined,
    preserveScrollPosition: true,
    edgeThreshold: 120,
    stickToBottom:
      scenario === 'vertical-prepend' || scenario === 'horizontal-prepend',
  })

  const scrollToStartPoint = useCallback(() => {
    if (config.initialPosition === 'bottom') {
      list.scrollToBottom()
      return
    }

    if (config.initialPosition === 'center') {
      list.scrollToIndex(Math.floor(messages.length / 2), 'center')
      return
    }

    list.scrollToOffset(0)
  }, [config.initialPosition, list, messages.length])

  useLayoutEffect(() => {
    if (
      config.initialPosition !== 'center' ||
      didCenterInitialPositionRef.current ||
      list.range.startIndex === -1
    ) {
      return
    }

    didCenterInitialPositionRef.current = true
    window.requestAnimationFrame(() => {
      list.scrollToIndex(Math.floor(messages.length / 2), 'center')
    })
  }, [config.initialPosition, list, messages.length])

  return (
    <section className="scenario-panel">
      <div className="scenario-toolbar">
        <div>
          <strong>{config.title}</strong>
          <span>
            已加载 {messages.length} / {totalMessageCount} 条，源范围{' '}
            {loadedStart + 1}-{loadedEnd}，渲染范围 {list.range.startIndex}-
            {list.range.endIndex}
          </span>
        </div>
        <div className="actions">
          <button
            disabled={!canLoadOlder || loadingOlder}
            onClick={loadOlder}
            type="button"
          >
            {loadingOlder ? '加载中' : config.loadStartLabel}
          </button>
          <button
            disabled={!canLoadNewer || loadingNewer}
            onClick={loadNewer}
            type="button"
          >
            {loadingNewer ? '加载中' : config.loadEndLabel}
          </button>
          <button onClick={insertRandomMessage} type="button">
            随机插入
          </button>
          <button onClick={scrollToStartPoint} type="button">
            回到起点
          </button>
        </div>
      </div>

      <section
        ref={list.containerRef}
        className={`viewport chat-viewport ${
          config.axis === 'horizontal' ? 'horizontal-viewport' : ''
        }`}
        aria-label={`${config.title} virtual list`}
      >
        <div style={list.innerStyle}>
          {list.virtualItems.map((virtualItem) => (
            <MessageRow
              axis={config.axis}
              isFirst={virtualItem.index === 0}
              isLast={virtualItem.index === messages.length - 1}
              key={virtualItem.key}
              virtualItem={virtualItem}
            />
          ))}
        </div>
      </section>

      <div className="scenario-footer">
        <button
          className="code-toggle"
          onClick={() => setShowCode((current) => !current)}
          type="button"
        >
          {showCode ? '隐藏代码' : '显示代码'}
        </button>
      </div>

      {showCode ? (
        <pre className="code-panel code-panel-enter">
          <code>{getScenarioCode('React', scenario)}</code>
        </pre>
      ) : null}
    </section>
  )
}

function MessageRow({
  axis,
  isFirst,
  isLast,
  virtualItem,
}: {
  axis: 'horizontal' | 'vertical'
  isFirst: boolean
  isLast: boolean
  virtualItem: ReactVirtualItem<ChatMessage>
}) {
  const edgeClass =
    `${isFirst ? 'edge-start' : ''} ${isLast ? 'edge-end' : ''}`
  const horizontalSizeClass =
    axis === 'horizontal'
      ? getHorizontalMessageSizeClass(virtualItem.item)
      : ''

  return (
    <article
      ref={virtualItem.measureRef}
      className={`message ${axis === 'horizontal' ? 'horizontal-message' : ''} ${horizontalSizeClass} ${edgeClass} ${
        virtualItem.item.mine ? 'mine' : ''
      }`}
      style={virtualItem.style}
    >
      <div className="bubble">
        <div className="message-meta">
          <strong>{virtualItem.item.author}</strong>
          <span>#{virtualItem.item.id}</span>
        </div>
        <p>{virtualItem.item.text}</p>
        {virtualItem.item.image ? (
          <img
            alt={virtualItem.item.image.alt}
            className="message-image"
            loading="lazy"
            src={virtualItem.item.image.src}
          />
        ) : null}
        {virtualItem.item.preText ? (
          <PreText value={virtualItem.item.preText} />
        ) : null}
      </div>
    </article>
  )
}

function PreText({ value }: { value: string }) {
  return <pre className="pretext">{value}</pre>
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
