/**
 * Prints the word-pair quality review for the curated bank and exits non-zero if any pair
 * needs attention. Run with `npm run words:review`. Development tool only: the game server
 * never imports it.
 */
import { fallbackWordBank } from "./data/wordBank.js";
import { formatWordBankReport, reviewWordBank } from "./data/wordPairReview.js";

const report = reviewWordBank(fallbackWordBank);
console.log(formatWordBankReport(report));
process.exitCode = report.passed ? 0 : 1;
