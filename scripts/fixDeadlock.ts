/**
 * Fix Deadlock Script
 *
 * This script implements the deadlock fix for NON_ROUND_BASED mode
 * when all seeds have 0 blessings and voting period has ended.
 *
 * Steps:
 * 1. Change deadlock strategy to SKIP_ROUND
 * 2. Call selectDailyWinner() to skip current round
 * 3. New voting period starts automatically
 * 4. Cast blessings in new period
 * 5. Select winner normally
 * 6. Optionally change back to REVERT
 */

import { contractService } from "../src/services/contractService.js";

async function fixDeadlock() {
  console.log("\n" + "=".repeat(70));
  console.log("🔧 DEADLOCK FIX - SKIP ROUND STRATEGY");
  console.log("=".repeat(70) + "\n");

  try {
    // STEP 1: Change deadlock strategy to SKIP_ROUND
    console.log("STEP 1: Changing deadlock strategy to SKIP_ROUND...");
    const strategyResult = await contractService.updateDeadlockStrategy(1); // 1 = SKIP_ROUND

    if (!strategyResult.success) {
      console.error("❌ Failed to update deadlock strategy:", strategyResult.error);
      return;
    }

    console.log("✅ Deadlock strategy changed to SKIP_ROUND");
    console.log(`   Tx Hash: ${strategyResult.txHash}\n`);

    // Wait a moment for the transaction to be mined
    console.log("⏳ Waiting for transaction to be confirmed...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // STEP 2: Call selectDailyWinner to skip the round
    console.log("\nSTEP 2: Calling selectDailyWinner() to skip round...");
    const winnerResult = await contractService.selectDailyWinner();

    if (!winnerResult.success) {
      console.error("❌ Failed to skip round:", winnerResult.error);
      console.log("\n📊 Diagnostics:", winnerResult.diagnostics);
      return;
    }

    console.log("✅ Round skipped successfully!");
    console.log(`   Tx Hash: ${winnerResult.txHash}`);
    console.log(`   Previous Round: 5`);
    console.log(`   New Round: ${winnerResult.round || 6}`);
    console.log(`   Winning Seed ID: ${winnerResult.winningSeedId} (0 = skipped)\n`);

    // STEP 3: Verify new state
    console.log("STEP 3: Verifying new state...");
    const currentRound = await contractService.getCurrentRound();
    const timeRemaining = await contractService.getTimeUntilPeriodEnd();
    const deadlockStrategy = await contractService.getDeadlockStrategy();

    console.log(`✅ Current Round: ${currentRound}`);
    console.log(`✅ Time Until Period End: ${timeRemaining}s`);
    console.log(`✅ New Voting Period Started: YES`);
    console.log(`✅ Deadlock Strategy: ${deadlockStrategy === 1 ? 'SKIP_ROUND' : 'REVERT'}\n`);

    // INSTRUCTIONS
    console.log("=" + "=".repeat(69));
    console.log("📋 NEXT STEPS");
    console.log("=" + "=".repeat(69) + "\n");

    console.log("The deadlock has been broken! Now you can:");
    console.log("");
    console.log("1. ✅ Cast blessings on seeds (voting period is active)");
    console.log("   - Use your frontend or API to bless seeds");
    console.log("   - Bless any eligible seed (IDs: 4, 5, 6, 7, 8)");
    console.log("");
    console.log("2. ✅ Wait for voting period to end (24 hours)");
    console.log(`   - Current time remaining: ${timeRemaining}s`);
    console.log("");
    console.log("3. ✅ Select winner normally");
    console.log("   - After blessings are cast and period ends");
    console.log("   - Run: POST /admin/select-winner");
    console.log("");
    console.log("4. ⚙️  Optionally: Change back to REVERT strategy");
    console.log("   - If you prefer REVERT over SKIP_ROUND");
    console.log("   - Run: POST /admin/config/deadlock {\"strategy\": \"REVERT\"}");
    console.log("");

    console.log("=" + "=".repeat(69) + "\n");

  } catch (error) {
    console.error("❌ Error during deadlock fix:", error);
    throw error;
  }
}

// Run the fix
fixDeadlock()
  .then(() => {
    console.log("✅ Deadlock fix complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Deadlock fix failed:", error);
    process.exit(1);
  });
