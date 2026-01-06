/**
 * Skip Round Script
 *
 * Executes the deadlock fix by:
 * 1. Changing deadlock strategy to SKIP_ROUND
 * 2. Calling selectDailyWinner() to skip current round
 * 3. Starting a new voting period
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

import { contractService } from "../src/services/contractService.js";

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("🔧 SKIPPING ROUND TO BREAK DEADLOCK");
  console.log("=".repeat(70) + "\n");

  // Check current state
  console.log("📊 Current State:");
  const currentRound = await contractService.getCurrentRound();
  const deadlockStrategy = await contractService.getDeadlockStrategy();
  const timeRemaining = await contractService.getTimeUntilPeriodEnd();

  const strategyNames = ["REVERT", "SKIP_ROUND"];
  console.log(`  Round: ${currentRound}`);
  console.log(`  Deadlock Strategy: ${strategyNames[deadlockStrategy]}`);
  console.log(`  Time Until Period End: ${timeRemaining}s\n`);

  // STEP 1: Change deadlock strategy to SKIP_ROUND (if needed)
  if (deadlockStrategy !== 1) {
    console.log("STEP 1: Changing deadlock strategy to SKIP_ROUND...");
    const result = await contractService.updateDeadlockStrategy(1);

    if (!result.success) {
      console.error(`  ❌ Failed: ${result.error}`);
      throw new Error(result.error);
    }

    console.log(`  ⏳ Transaction sent: ${result.txHash}`);
    console.log(`  ✅ Strategy updated\n`);

    // Wait for confirmation
    console.log("  ⏳ Waiting 10 seconds for confirmation...");
    await new Promise(resolve => setTimeout(resolve, 10000));
  } else {
    console.log("STEP 1: ✅ Already using SKIP_ROUND strategy\n");
  }

  // STEP 2: Call selectDailyWinner to skip the round
  console.log("STEP 2: Calling selectDailyWinner() to skip round...");
  const result = await contractService.selectDailyWinner();

  if (!result.success) {
    console.error(`  ❌ Failed to skip round: ${result.error}`);
    if (result.diagnostics) {
      console.log("\n  📊 Diagnostics:");
      console.log(`     Round: ${result.diagnostics.currentRound}`);
      console.log(`     Seeds in Round: ${result.diagnostics.seedsInRound}`);
      console.log(`     Time Remaining: ${result.diagnostics.timeRemaining}s`);
      console.log(`     Leader Seed ID: ${result.diagnostics.currentLeader.seedId}`);
      console.log(`     Leader Score: ${result.diagnostics.currentLeader.score}`);
    }
    throw new Error(result.error);
  }

  console.log(`  ⏳ Transaction sent: ${result.txHash}`);
  console.log(`  ✅ Round skipped successfully!`);
  console.log(`  📍 Winning Seed ID: ${result.winningSeedId} (0 = round skipped)\n`);

  // Wait for confirmation
  console.log("  ⏳ Waiting 10 seconds for confirmation...");
  await new Promise(resolve => setTimeout(resolve, 10000));

  // STEP 3: Verify new state
  console.log("STEP 3: Verifying new state...");
  const newRound = await contractService.getCurrentRound();
  const newTimeRemaining = await contractService.getTimeUntilPeriodEnd();
  const eligibleSeeds = await contractService.getEligibleSeedsCount();

  console.log(`  Current Round: ${newRound}`);
  console.log(`  Time Until Period End: ${newTimeRemaining}s (~${Number(newTimeRemaining) / 3600} hours)`);
  console.log(`  Eligible Seeds: ${eligibleSeeds}`);
  console.log(`  Voting Period Active: ${Number(newTimeRemaining) > 0 ? 'YES ✅' : 'NO ❌'}\n`);

  // Summary
  console.log("=" + "=".repeat(69));
  console.log("✅ DEADLOCK BROKEN!");
  console.log("=" + "=".repeat(69) + "\n");

  console.log("Next steps:");
  console.log(`  1. Cast blessings on seeds (period ends in ~${Math.floor(Number(newTimeRemaining) / 3600)} hours)`);
  console.log(`  2. Wait for voting period to end`);
  console.log(`  3. Call selectDailyWinner() to select winner normally\n`);

  console.log("Transaction Details:");
  console.log(`  Network: Base Sepolia`);
  console.log(`  Block Explorer: https://sepolia.basescan.org/tx/${result.txHash}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  });
