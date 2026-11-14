import { memo } from "react";
import { Info } from "lucide-react";
import type { ChatMessage } from "@imposter/shared";
import { formatChatTime } from "../../chat/chatService.js";

export const ChatMessageItem = memo(function ChatMessageItem({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const time = formatChatTime(message.sentAt);
  const dateTime = new Date(message.sentAt).toISOString();

  if (message.kind === "system") {
    return (
      <li className="chat-system">
        <Info size={14} aria-hidden="true" />
        <span>{message.text}</span>
        <time dateTime={dateTime}>{time}</time>
      </li>
    );
  }

  return (
    <li className={mine ? "chat-msg mine" : "chat-msg"}>
      <div className="chat-meta">
        <strong>{mine ? "You" : message.playerName}</strong>
        <time dateTime={dateTime}>{time}</time>
      </div>
      {/* Rendered as text: React escapes it, so player input can never inject markup. */}
      <p className="chat-bubble">{message.text}</p>
    </li>
  );
});
