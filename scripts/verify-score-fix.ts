/**
 * Verification Script for Blessing Score Fix
 *
 * This script demonstrates the before/after calculations for the blessing score fix.
 * Run with: npx tsx scripts/verify-score-fix.ts
 */

function sqrt(n: number): number {
  return Math.floor(Math.sqrt(n));
}

function calculateOldScore(blessings: number, decayFactor: number): number {
  const sqrtBlessings = sqrt(blessings);
  return Math.floor((sqrtBlessings * decayFactor) / 1000);
}

function calculateNewScore(blessings: number, decayFactor: number): number {
  const sqrtBlessings = sqrt(blessings) * 1000; // Scale by 1000
  return Math.floor((sqrtBlessings * decayFactor) / 1000);
}

console.log("═══════════════════════════════════════════════════════");
console.log("  Blessing Score Calculation - Before & After Fix");
console.log("═══════════════════════════════════════════════════════\n");

// Test cases
const testCases = [
  { blessings: 1, decay: 10, label: "1 blessing, 1% decay (final hour)" },
  { blessings: 1, decay: 100, label: "1 blessing, 10% decay" },
  { blessings: 1, decay: 1000, label: "1 blessing, 100% decay (start)" },
  { blessings: 4, decay: 10, label: "4 blessings, 1% decay" },
  { blessings: 9, decay: 10, label: "9 blessings, 1% decay" },
  { blessings: 100, decay: 10, label: "100 blessings, 1% decay" },
  { blessings: 100, decay: 1000, label: "100 blessings, 100% decay" },
];

console.log("Test Cases:");
console.log("─".repeat(80));

let allPassed = true;

for (const testCase of testCases) {
  const oldScore = calculateOldScore(testCase.blessings, testCase.decay);
  const newScore = calculateNewScore(testCase.blessings, testCase.decay);
  const sqrtVal = sqrt(testCase.blessings);
  const passed = newScore > 0;

  if (!passed) allPassed = false;

  console.log(`\n${testCase.label}`);
  console.log(`  Blessings: ${testCase.blessings}`);
  console.log(`  sqrt(${testCase.blessings}) = ${sqrtVal}`);
  console.log(`  Decay Factor: ${testCase.decay}/1000 (${(testCase.decay / 10)}%)`);
  console.log(`  Old Score: ${oldScore} ${oldScore === 0 ? "❌" : "✅"}`);
  console.log(`  New Score: ${newScore} ${newScore > 0 ? "✅" : "❌"}`);
  console.log(`  Improvement: ${newScore}x ${newScore > oldScore ? "✅" : "❌"}`);
}

console.log("\n" + "─".repeat(80));
console.log(`\n${allPassed ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}\n`);

// Key insights
console.log("Key Insights:");
console.log("─".repeat(80));
console.log("1. OLD: Single blessing with 1% decay = 0 (blocked winner selection) ❌");
console.log("2. NEW: Single blessing with 1% decay = 10 (allows winner selection) ✅");
console.log("3. Score now has 1000x more precision for fair competition");
console.log("4. All blessings now count towards the score, even late ones");
console.log("5. Early blessings still weighted higher (decay factor)");
console.log("\n" + "═".repeat(80));

// Edge cases
console.log("\nEdge Case Verification:");
console.log("─".repeat(80));

// Minimum score needed for winner selection
const minScoreNeeded = 1;
console.log(`\nMinimum score needed for winner selection: ${minScoreNeeded}`);

// Old system: How many blessings needed?
for (let i = 1; i <= 10000; i *= 10) {
  const oldScore = calculateOldScore(i, 10);
  if (oldScore >= minScoreNeeded) {
    console.log(`  OLD: Needs ≥${i} blessings (with 1% decay) to get score ≥ ${minScoreNeeded}`);
    break;
  }
}

// New system: How many blessings needed?
for (let i = 1; i <= 10000; i++) {
  const newScore = calculateNewScore(i, 10);
  if (newScore >= minScoreNeeded) {
    console.log(`  NEW: Needs ≥${i} blessing (with 1% decay) to get score ≥ ${minScoreNeeded} ✅`);
    break;
  }
}

console.log("\n" + "═".repeat(80) + "\n");
