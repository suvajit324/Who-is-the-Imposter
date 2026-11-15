import "dotenv/config";
import mongoose from "mongoose";
import { fallbackWordBank } from "./data/wordBank.js";
import { formatWordBankReport, reviewWordBank } from "./data/wordPairReview.js";
import { WordPairModel } from "./persistence/models.js";

// Never publish a word bank that fails review (duplicates, rejected or malformed pairs, open warnings).
const review = reviewWordBank(fallbackWordBank);
if (!review.passed) {
  console.error(formatWordBankReport(review));
  console.error("Word bank review failed; nothing was seeded. Run `npm run words:review` for details.");
  process.exit(1);
}

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.log(`No MONGODB_URI configured. Local fallback word bank has ${fallbackWordBank.length} reviewed pairs.`);
  process.exit(0);
}

await mongoose.connect(uri);
for (const pair of fallbackWordBank) {
  await WordPairModel.updateOne({ id: pair.id }, { $set: pair }, { upsert: true });
}
// Keep the collection identical to the reviewed bank: retired pairs (such as Mountain / Hill) are removed.
const { deletedCount } = await WordPairModel.deleteMany({ id: { $nin: fallbackWordBank.map((pair) => pair.id) } });
console.log(`Seeded ${fallbackWordBank.length} word pairs; removed ${deletedCount} retired pairs.`);
await mongoose.disconnect();
