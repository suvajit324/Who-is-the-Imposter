import mongoose, { Schema } from "mongoose";

const wordPairSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    wordA: { type: String, required: true },
    wordB: { type: String, required: true },
    category: { type: String, required: true },
    difficulty: { type: String, required: true },
    tags: [{ type: String }]
  },
  { timestamps: true }
);

const completedGameSchema = new Schema(
  {
    roomCode: { type: String, required: true },
    players: [{ id: String, name: String, score: Number }],
    roundHistory: { type: Schema.Types.Mixed, required: true },
    completedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export const WordPairModel = mongoose.models.WordPair ?? mongoose.model("WordPair", wordPairSchema);
export const CompletedGameModel = mongoose.models.CompletedGame ?? mongoose.model("CompletedGame", completedGameSchema);
