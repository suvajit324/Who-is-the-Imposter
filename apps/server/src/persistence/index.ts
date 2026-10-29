import mongoose from "mongoose";
import type { PublicRoomState } from "@imposter/shared";
import { CompletedGameModel } from "./models.js";

export type PersistenceAdapter = {
  enabled: boolean;
  connect: () => Promise<void>;
  saveCompletedGame: (state: PublicRoomState) => Promise<void>;
};

export function createPersistence(mongoUri?: string): PersistenceAdapter {
  const enabled = Boolean(mongoUri);
  return {
    enabled,
    async connect() {
      if (!mongoUri) return;
      await mongoose.connect(mongoUri);
      console.log("MongoDB connected. Completed games and word pairs will be persisted.");
    },
    async saveCompletedGame(state) {
      if (!mongoUri) return;
      await CompletedGameModel.create({
        roomCode: state.roomCode,
        players: state.players.map((player) => ({ id: player.id, name: player.name, score: player.score })),
        roundHistory: state.roundHistory
      });
    }
  };
}
