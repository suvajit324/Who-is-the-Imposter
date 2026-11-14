import type { ModerationConcern, ModerationEngine, ModerationOutcome } from "./moderator.js";

export type ModerationPolicy = {
  enabled: boolean;
  /** REVIEW_UNCERTAIN handling: "withhold" (not delivered, no strike) or "allow" (delivered). */
  uncertainPolicy: "withhold" | "allow";
  /** Every N withheld uncertain messages in a round count as one violation (0 disables). */
  uncertainPerViolation: number;
  /** Violations answered with a warning before restrictions start. */
  warningsBeforeRestriction: number;
  /** Restriction length for the 1st, 2nd, ... restriction in a round (last value repeats). Never permanent. */
  restrictionSeconds: number[];
  messages: {
    secret: string;
    hint: string;
    abuse: string;
    finalWarningSuffix: string;
    restricted: (seconds: number) => string;
    stillRestricted: (seconds: number) => string;
  };
};

export const defaultModerationPolicy: ModerationPolicy = {
  enabled: true,
  uncertainPolicy: "withhold",
  uncertainPerViolation: 3,
  warningsBeforeRestriction: 2,
  restrictionSeconds: [30, 60, 120],
  messages: {
    secret: "Your message may reveal secret information. Please rephrase it.",
    hint: "Giving hints about letters, spelling or word meaning is not allowed.",
    abuse: "Please keep the conversation respectful.",
    finalWarningSuffix: " Further violations will temporarily restrict your chat.",
    restricted: (seconds) => `Your chat is temporarily restricted for ${seconds} seconds because of repeated violations.`,
    stillRestricted: (seconds) => `Your chat is temporarily restricted. Try again in ${seconds} seconds.`
  }
};

export type ScreenInput = {
  /** Server-side player id (stable across reconnects, independent of display name). */
  playerId: string;
  roundNumber: number;
  /** Secret words the sender already knows (their own word), from trusted server state. */
  knownWords: readonly string[];
  text: string;
  now: number;
};

export type ScreenResult =
  | { allow: true; outcome: ModerationOutcome }
  | { allow: false; outcome: ModerationOutcome | "RESTRICTED"; message: string; /** Safe to replay for a retried clientMessageId. */ cacheable: boolean };

type PlayerRecord = { roundNumber: number; violations: number; uncertain: number; restrictions: number; restrictedUntil: number };

/**
 * Per-room moderation gate: runs the engine, then applies the violation policy.
 *
 * Feedback is deliberately generic (three fixed category messages plus escalation)
 * and never mentions which word, rule or term matched. Nothing here is broadcast:
 * results go only to the sender's ack.
 */
export class ChatModerationGate {
  private records = new Map<string, PlayerRecord>();

  constructor(
    private readonly engine: ModerationEngine,
    private readonly policy: ModerationPolicy = defaultModerationPolicy
  ) {}

  /** A brand-new game (rematch) starts with a clean slate. */
  reset(): void {
    this.records.clear();
  }

  screen(input: ScreenInput): ScreenResult {
    const record = this.record(input.playerId, input.roundNumber);
    if (record.restrictedUntil > input.now) {
      return { allow: false, outcome: "RESTRICTED", message: this.policy.messages.stillRestricted(Math.ceil((record.restrictedUntil - input.now) / 1000)), cacheable: false };
    }
    if (!this.policy.enabled) return { allow: true, outcome: "ALLOW" };

    const decision = this.engine.moderate(input.text, input.knownWords);
    if (decision.outcome === "ALLOW") return { allow: true, outcome: "ALLOW" };

    if (decision.outcome === "REVIEW_UNCERTAIN") {
      if (this.policy.uncertainPolicy === "allow") return { allow: true, outcome: decision.outcome };
      record.uncertain += 1;
      // A single uncertain classification never counts against the player; only a pattern does.
      const escalate = this.policy.uncertainPerViolation > 0 && record.uncertain % this.policy.uncertainPerViolation === 0;
      if (!escalate) return { allow: false, outcome: decision.outcome, message: this.categoryMessage(decision.concern), cacheable: true };
    }
    return { allow: false, outcome: decision.outcome, message: this.violation(record, decision.concern, input.now), cacheable: true };
  }

  private violation(record: PlayerRecord, concern: ModerationConcern | null, now: number): string {
    record.violations += 1;
    const base = this.categoryMessage(concern);
    if (record.violations < this.policy.warningsBeforeRestriction) return base;
    if (record.violations === this.policy.warningsBeforeRestriction) return base + this.policy.messages.finalWarningSuffix;
    const durations = this.policy.restrictionSeconds;
    const seconds = durations[Math.min(record.restrictions, durations.length - 1)] ?? 30;
    record.restrictions += 1;
    record.restrictedUntil = now + seconds * 1000;
    return this.policy.messages.restricted(seconds);
  }

  private categoryMessage(concern: ModerationConcern | null): string {
    if (concern === "abuse") return this.policy.messages.abuse;
    if (concern === "hint") return this.policy.messages.hint;
    return this.policy.messages.secret;
  }

  private record(playerId: string, roundNumber: number): PlayerRecord {
    let record = this.records.get(playerId);
    if (!record) {
      record = { roundNumber, violations: 0, uncertain: 0, restrictions: 0, restrictedUntil: 0 };
      this.records.set(playerId, record);
    }
    if (record.roundNumber !== roundNumber) {
      // Violation counts are per round; an active restriction still runs out on its own timer.
      record.roundNumber = roundNumber;
      record.violations = 0;
      record.uncertain = 0;
      record.restrictions = 0;
    }
    return record;
  }
}
