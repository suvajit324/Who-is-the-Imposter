import { useLayoutEffect, useRef } from "react";
import { MessageCircle } from "lucide-react";
import type { PublicRoomState } from "@imposter/shared";
import { chatAvailability } from "../../chat/chatService.js";
import { useRoomChat } from "../../chat/useRoomChat.js";
import { Badge } from "../ui.js";
import { ChatInput } from "./ChatInput.js";
import { ChatMessageItem } from "./ChatMessage.js";

const STICK_TO_BOTTOM_PX = 80;

export function ChatBox({ state, meId, sessionKey }: { state: PublicRoomState; meId: string | null; sessionKey: number }) {
  const { messages, synced, connected, send } = useRoomChat(sessionKey);
  const availability = chatAvailability(state.phase, state.settings);
  const canSend = availability.open && connected && synced;

  const listRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);
  const lastMessage = messages.at(-1);

  // Follow new messages, unless the reader has scrolled up to read older ones.
  // Your own messages always scroll into view.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (stickToBottom.current || lastMessage?.playerId === meId) list.scrollTop = list.scrollHeight;
  }, [lastMessage?.id, lastMessage?.playerId, meId]);

  const statusTone = !connected || !synced ? "amber" : availability.open ? "green" : "muted";
  const statusLabel = !connected ? "Offline" : !synced ? "Syncing" : availability.open ? "Open" : "Closed";
  const placeholder = !connected
    ? "Reconnecting..."
    : !synced
      ? "Loading chat..."
      : availability.open
        ? "Say something to the room"
        : "Chat is closed";

  return (
    <section className="panel chat-box" aria-label="Room Discussion">
      <header className="chat-header">
        <div className="chat-title">
          <MessageCircle size={20} aria-hidden="true" />
          <div>
            <h2>Room Discussion</h2>
            <p>Room <span className="chat-room-code">{state.roomCode}</span></p>
          </div>
        </div>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </header>

      <ol
        className="chat-list"
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
        onScroll={(event) => {
          const list = event.currentTarget;
          stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_TO_BOTTOM_PX;
        }}
      >
        {messages.length === 0 ? (
          <li className="chat-empty">
            <strong>No messages yet.</strong>
            <span>When discussion starts, compare clues and call out whoever sounds off.</span>
          </li>
        ) : (
          messages.map((message) => <ChatMessageItem key={message.id} message={message} mine={message.playerId === meId} />)
        )}
      </ol>

      {!availability.open && <p className="chat-notice">{availability.notice}</p>}
      <ChatInput disabled={!canSend} placeholder={placeholder} onSend={send} />
    </section>
  );
}
