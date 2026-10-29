import "dotenv/config";
import mongoose from "mongoose";
import { fallbackWordBank } from "./data/wordBank.js";
import { WordPairModel } from "./persistence/models.js";

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.log(`No MONGODB_URI configured. Local fallback word bank has ${fallbackWordBank.length} pairs.`);
  process.exit(0);
}

await mongoose.connect(uri);
for (const pair of fallbackWordBank) {
  await WordPairModel.updateOne({ id: pair.id }, { $set: pair }, { upsert: true });
}
console.log(`Seeded ${fallbackWordBank.length} word pairs.`);
await mongoose.disconnect();
