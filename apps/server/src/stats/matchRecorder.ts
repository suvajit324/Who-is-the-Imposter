import type { MatchRecord, Store } from "../store/index.js";

export type RecordResult = "saved" | "duplicate" | "failed";

export type MatchRecorderOptions = {
  /** Waits between attempts after a failure; one attempt plus one retry per entry. */
  retryDelaysMs?: number[];
};

const REMEMBERED_IDS = 2_000;

/**
 * Saves completed games exactly once.
 *  - The store keys matches by game id, so a repeated save can never create a second record.
 *  - Ids already saved or being saved are remembered here, so repeated calls do not even reach the database.
 *  - A failed save is retried a few times; a retry that finds the record already there counts as saved.
 * Failures are logged and never thrown: a database problem must not affect the game.
 */
export class MatchRecorder {
  private readonly retryDelaysMs: number[];
  private readonly inFlight = new Map<string, Promise<RecordResult>>();
  private readonly finished = new Set<string>();

  constructor(
    private readonly store: Store,
    options: MatchRecorderOptions = {}
  ) {
    this.retryDelaysMs = options.retryDelaysMs ?? [2_000, 10_000, 30_000];
  }

  record(match: MatchRecord): Promise<RecordResult> {
    if (this.finished.has(match.id)) return Promise.resolve("duplicate");
    const pending = this.inFlight.get(match.id);
    if (pending) return pending.then(() => "duplicate");

    const attempt = this.save(match).finally(() => this.inFlight.delete(match.id));
    this.inFlight.set(match.id, attempt);
    return attempt;
  }

  private async save(match: MatchRecord): Promise<RecordResult> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await this.store.saveMatch(match);
        this.remember(match.id);
        return result;
      } catch (error) {
        const delay = this.retryDelaysMs[attempt];
        if (delay === undefined) {
          console.error(`[matches] Could not save completed game ${match.id} after ${attempt + 1} attempts:`, error);
          return "failed";
        }
        console.error(`[matches] Saving completed game ${match.id} failed; retrying in ${delay} ms.`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private remember(id: string): void {
    this.finished.add(id);
    if (this.finished.size > REMEMBERED_IDS) {
      const oldest = this.finished.values().next().value;
      if (oldest !== undefined) this.finished.delete(oldest);
    }
  }
}
