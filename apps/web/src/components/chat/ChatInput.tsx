import { useRef, useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { CHAT_MAX_LENGTH, validateChatText } from "@imposter/shared";

const COUNTER_THRESHOLD = CHAT_MAX_LENGTH - 60;

export function ChatInput({ disabled, placeholder, onSend }: {
  disabled: boolean;
  placeholder: string;
  onSend: (text: string) => Promise<string | null>;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  // A ref (not state) guards against double submits from fast double-clicks / Enter repeats.
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || inFlight.current) return;
    const validation = validateChatText(text);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    inFlight.current = true;
    setSending(true);
    setError("");
    try {
      const failure = await onSend(validation.text);
      if (failure) setError(failure);
      else setText("");
    } finally {
      inFlight.current = false;
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const remaining = CHAT_MAX_LENGTH - text.length;

  return (
    <form className="chat-input" onSubmit={submit} noValidate>
      <div className="chat-input-row">
        <label className="sr-only" htmlFor="chat-message">Message</label>
        <input
          id="chat-message"
          ref={inputRef}
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "chat-error" : undefined}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError("");
          }}
        />
        <button type="submit" className="btn chat-send" disabled={disabled || sending || !text.trim()} aria-label="Send message">
          <Send size={18} />
          <span>Send</span>
        </button>
      </div>
      {(error || text.length >= COUNTER_THRESHOLD) && (
        <div className="chat-input-foot">
          {error ? <p id="chat-error" className="chat-error" role="alert">{error}</p> : <span />}
          {text.length >= COUNTER_THRESHOLD && (
            <span className={remaining <= 0 ? "chat-counter over" : "chat-counter"}>{text.length}/{CHAT_MAX_LENGTH}</span>
          )}
        </div>
      )}
    </form>
  );
}
