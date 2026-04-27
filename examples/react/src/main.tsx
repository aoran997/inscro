import React, { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { useVirtualList } from "../../../src/react";
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

function App() {
  const allMessages = useMemo(() => makeMessages(1200), []);
  const [startIndex, setStartIndex] = useState(allMessages.length - 80);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const messages = allMessages.slice(startIndex);

  const loadOlder = useCallback(() => {
    if (loadingOlder || startIndex === 0) {
      return;
    }

    setLoadingOlder(true);
    window.setTimeout(() => {
      setStartIndex((current) => Math.max(0, current - 40));
      setLoadingOlder(false);
    }, 420);
  }, [loadingOlder, startIndex]);

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

  return (
    <main className="app-shell">
      <header className="toolbar">
        <div>
          <h1>React 聊天虚拟列表</h1>
          <p>
            已加载 {messages.length} / {allMessages.length} 条，范围{" "}
            {list.range.startIndex}-{list.range.endIndex}
          </p>
        </div>
        <div className="actions">
          <button onClick={loadOlder} disabled={loadingOlder || startIndex === 0}>
            {loadingOlder ? "加载中" : "加载更早"}
          </button>
          <button onClick={() => list.scrollToBottom()}>回到底部</button>
        </div>
      </header>

      <section
        ref={list.containerRef}
        className="viewport chat-viewport"
        aria-label="React chat virtual list"
      >
        <div style={list.innerStyle}>
          {list.virtualItems.map((virtualItem) => (
            <article
              key={virtualItem.key}
              ref={virtualItem.measureRef}
              className={`message ${virtualItem.item.mine ? "mine" : ""}`}
              style={virtualItem.style}
            >
              <div className="bubble">
                <div className="message-meta">
                  <strong>{virtualItem.item.author}</strong>
                  <span>#{virtualItem.item.id}</span>
                </div>
                <p>{virtualItem.item.text}</p>
                {virtualItem.item.preText ? (
                  <PreText value={virtualItem.item.preText} />
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function PreText({ value }: { value: string }) {
  return <pre className="pretext">{value}</pre>;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
