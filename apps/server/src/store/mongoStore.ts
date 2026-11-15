import mongoose, { Schema } from "mongoose";
import type { AvatarId, StorageMode } from "@imposter/shared";
import type { MatchParticipantRecord, MatchRecord, SessionRecord, Store, UserRecord } from "./types.js";

/*
 * MongoDB store. Uses the default mongoose connection opened by persistence.connect().
 * New collections only (users, sessions, matches); the existing wordpairs and
 * completedgames collections are not touched.
 */

const userSchema = new Schema(
  {
    _id: { type: String, required: true },
    username: { type: String, required: true },
    usernameKey: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    avatar: { type: String, required: true },
    createdAt: { type: Date, required: true }
  },
  { versionKey: false, collection: "users" }
);

const sessionSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true }
  },
  { versionKey: false, collection: "sessions" }
);
// MongoDB deletes each session document once its expiresAt has passed.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const participantSchema = new Schema(
  {
    seat: { type: Number, required: true },
    userId: { type: String, default: null },
    displayName: { type: String, required: true },
    avatar: { type: String, default: null },
    finalScore: { type: Number, required: true },
    finalRank: { type: Number, required: true },
    outcome: { type: String, required: true, enum: ["win", "draw", "loss"] },
    connectedAtEnd: { type: Boolean, required: true }
  },
  { _id: false }
);

// A completed game. No words, clues, roles, votes or room code are stored.
const matchSchema = new Schema(
  {
    _id: { type: String, required: true },
    status: { type: String, required: true, enum: ["completed"] },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, required: true },
    durationSeconds: { type: Number, required: true },
    counted: { type: Boolean, required: true },
    wordSource: { type: String, required: true, enum: ["curated", "custom"] },
    settings: {
      categories: [{ type: String }],
      difficulty: { type: String, required: true },
      rounds: { type: Number, required: true }
    },
    roundsPlayed: { type: Number, required: true },
    participants: { type: [participantSchema], required: true }
  },
  { versionKey: false, collection: "matches" }
);
matchSchema.index({ "participants.userId": 1, endedAt: -1 });
matchSchema.index({ counted: 1, endedAt: -1 });

const UserModel = mongoose.models.ImposterUser ?? mongoose.model("ImposterUser", userSchema);
const SessionModel = mongoose.models.ImposterSession ?? mongoose.model("ImposterSession", sessionSchema);
const MatchModel = mongoose.models.ImposterMatch ?? mongoose.model("ImposterMatch", matchSchema);

function matchFilter(userId: string, countedOnly = false): Record<string, unknown> {
  // userId is always a server-generated string; `$eq` keeps it from ever being read as an operator.
  const filter: Record<string, unknown> = { "participants.userId": { $eq: userId } };
  if (countedOnly) filter.counted = true;
  return filter;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

// Explicit mapping: only known fields leave the database layer.
function toUser(doc: any): UserRecord {
  return {
    id: String(doc._id),
    username: String(doc.username),
    usernameKey: String(doc.usernameKey),
    passwordHash: String(doc.passwordHash),
    avatar: doc.avatar as AvatarId,
    createdAt: new Date(doc.createdAt)
  };
}

function toSession(doc: any): SessionRecord {
  return { tokenHash: String(doc._id), userId: String(doc.userId), createdAt: new Date(doc.createdAt), expiresAt: new Date(doc.expiresAt) };
}

function toParticipant(doc: any): MatchParticipantRecord {
  return {
    seat: Number(doc.seat),
    userId: doc.userId ?? null,
    displayName: String(doc.displayName),
    avatar: (doc.avatar ?? null) as AvatarId | null,
    finalScore: Number(doc.finalScore),
    finalRank: Number(doc.finalRank),
    outcome: doc.outcome === "win" || doc.outcome === "draw" ? doc.outcome : "loss",
    connectedAtEnd: Boolean(doc.connectedAtEnd)
  };
}

function toMatch(doc: any): MatchRecord {
  return {
    id: String(doc._id),
    status: "completed",
    startedAt: new Date(doc.startedAt),
    endedAt: new Date(doc.endedAt),
    durationSeconds: Number(doc.durationSeconds ?? 0),
    counted: Boolean(doc.counted),
    wordSource: doc.wordSource === "custom" ? "custom" : "curated",
    settings: { categories: [...(doc.settings?.categories ?? [])], difficulty: doc.settings?.difficulty, rounds: Number(doc.settings?.rounds) },
    roundsPlayed: Number(doc.roundsPlayed ?? 0),
    participants: (doc.participants ?? []).map(toParticipant)
  };
}

export class MongoStore implements Store {
  /** Builds the indexes (unique usernames, session expiry, match lookups) before any request is served. */
  async ready(): Promise<void> {
    await Promise.all([UserModel.init(), SessionModel.init(), MatchModel.init()]);
  }

  storageMode(): StorageMode {
    return mongoose.connection.readyState === 1 ? "mongodb" : "mongodb-unavailable";
  }

  async createUser(user: UserRecord): Promise<"created" | "username-taken"> {
    try {
      await UserModel.create({
        _id: user.id,
        username: user.username,
        usernameKey: user.usernameKey,
        passwordHash: user.passwordHash,
        avatar: user.avatar,
        createdAt: user.createdAt
      });
      return "created";
    } catch (error) {
      if (isDuplicateKeyError(error)) return "username-taken";
      throw error;
    }
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const doc = await UserModel.findById(id).lean();
    return doc ? toUser(doc) : null;
  }

  async findUserByUsernameKey(usernameKey: string): Promise<UserRecord | null> {
    const doc = await UserModel.findOne({ usernameKey }).lean();
    return doc ? toUser(doc) : null;
  }

  async findUsersByIds(ids: readonly string[]): Promise<UserRecord[]> {
    if (ids.length === 0) return [];
    const docs = await UserModel.find({ _id: { $in: [...ids] } }).lean();
    return docs.map(toUser);
  }

  async updateUserAvatar(id: string, avatar: AvatarId): Promise<void> {
    await UserModel.updateOne({ _id: id }, { $set: { avatar } });
  }

  async createSession(session: SessionRecord): Promise<void> {
    await SessionModel.create({ _id: session.tokenHash, userId: session.userId, createdAt: session.createdAt, expiresAt: session.expiresAt });
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    const doc = await SessionModel.findById(tokenHash).lean();
    return doc ? toSession(doc) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await SessionModel.deleteOne({ _id: tokenHash });
  }

  async saveMatch(match: MatchRecord): Promise<"saved" | "duplicate"> {
    try {
      await MatchModel.create({
        _id: match.id,
        status: match.status,
        startedAt: match.startedAt,
        endedAt: match.endedAt,
        durationSeconds: match.durationSeconds,
        counted: match.counted,
        wordSource: match.wordSource,
        settings: match.settings,
        roundsPlayed: match.roundsPlayed,
        participants: match.participants
      });
      return "saved";
    } catch (error) {
      if (isDuplicateKeyError(error)) return "duplicate";
      throw error;
    }
  }

  async listMatchesForUser(userId: string, options: { countedOnly?: boolean; limit?: number; skip?: number } = {}): Promise<MatchRecord[]> {
    let query = MatchModel.find(matchFilter(userId, options.countedOnly)).sort({ endedAt: -1, _id: -1 });
    if (options.skip) query = query.skip(options.skip);
    if (options.limit !== undefined) query = query.limit(options.limit);
    const docs = await query.lean();
    return docs.map(toMatch);
  }

  async countMatchesForUser(userId: string, options: { countedOnly?: boolean } = {}): Promise<number> {
    return MatchModel.countDocuments(matchFilter(userId, options.countedOnly));
  }

  async listCountedMatches(): Promise<MatchRecord[]> {
    const docs = await MatchModel.find({ counted: true }).lean();
    return docs.map(toMatch);
  }
}
