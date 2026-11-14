import { useCallback, useEffect, useRef, useState } from "react";
import { validateChatText, type ChatHistory, type ChatMessage } from "@imposter/shared";
import { socket } from "../state/socket.js";
import {
  applyHistory,
  applyLive,
  createClientMessageId,
  emptyChatLog,
  fetchChatHistory,
  sendChatMessage,
  type ChatLog
} from "./chatService.js";

/**
 * Keeps the local chat log in sync with the server.
 *
 * `sessionKey` changes every time the player (re)enters the room, which is the
 * point where the server has re-bound this socket to the player. The full
 * history is re-fetched then, so messages missed while offline are recovered.
 */
export function useRoomChat(sessionKey: number) {
  const [log, setLog] = useState<ChatLog>(emptyChatLog);
  const logRef = useRef<ChatLog>(emptyChatLog);
  const [synced, setSynced] = useState(false);
  const [connected, setConnected] = useState(socket.connected);
  const syncing = useRef(false);
  const syncAgain = useRef(false);
  const pending = useRef<{ text: string; clientMessageId: string } | null>(null);

  const commit = useCallback((next: ChatLog) => {
    if (next === logRef.current) return;
    logRef.current = next;
    setLog(next);
  }, []);

  const resync = useCallback(async () => {
    if (syncing.current) {
      syncAgain.current = true;
      return;
    }
    syncing.current = true;
    try {
      do {
        syncAgain.current = false;
        const response = await fetchChatHistory();
        if (response.ok) {
          commit(applyHistory(logRef.current, response));
          setSynced(true);
        }
      } while (syncAgain.current);
    } finally {
      syncing.current = false;
    }
  }, [commit]);

  useEffect(() => {
    void resync();
  }, [sessionKey, resync]);

  useEffect(() => {
    const onMessage = (message: ChatMessage) => {
      const result = applyLive(logRef.current, message);
      commit(result.log);
      if (result.needsResync) void resync();
    };
    const onHistory = (history: ChatHistory) => commit(applyHistory(logRef.current, history));
    const onConnect = () => setConnected(true);
    const onDisconnect = () => {
      setConnected(false);
      setSynced(false);
    };
    socket.on("chat:message", onMessage);
    socket.on("chat:history", onHistory);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("chat:message", onMessage);
      socket.off("chat:history", onHistory);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [commit, resync]);

  /** Returns null on success or a user-facing error message. */
  const send = useCallback(async (raw: string): Promise<string | null> => {
    const validation = validateChatText(raw);
    if (!validation.ok) return validation.message;
    // Reuse the id when retrying the same text, so a resend after a lost ack is not duplicated.
    if (!pending.current || pending.current.text !== validation.text) {
      pending.current = { text: validation.text, clientMessageId: createClientMessageId() };
    }
    const response = await sendChatMessage(validation.text, pending.current.clientMessageId);
    if (!response.ok) return response.message;
    pending.current = null;
    const result = applyLive(logRef.current, response.chatMessage);
    commit(result.log);
    if (result.needsResync) void resync();
    return null;
  }, [commit, resync]);

  return { messages: log.messages, synced, connected, send };
}
