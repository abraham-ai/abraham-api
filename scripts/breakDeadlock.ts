/**
 * Break Deadlock Script
 *
 * This script helps break the current deadlock in NON_ROUND_BASED mode
 * where all eligible seeds have 0 blessings.
 *
 * Solutions:
 * 1. Modify contract to allow 0-blessing winners (requires contract upgrade - NOT FEASIBLE)
 * 2. Get users to bless at least one seed (MANUAL - requires user action)
 * 3. Change deadlock strategy to handle this case (LIMITED - won't help with current contract logic)
 * 4. Switch to ROUND_BASED mode temporarily (WORKAROUND)
 *
 * Best immediate solution: Get at least one blessing cast on any seed
 */

import { contractService } from "../src/services/contractService.js";

async function diagnoseDeadlock() {
  console.log("\n" + "=".repeat(70));
  console.log("🔍 DEADLOCK DIAGNOSIS");
  console.log("=".repeat(70) + "\n");

  try {
    // 1. Check round mode
    const roundMode = await contractService.getRoundMode();
    const roundModeNames = ["ROUND_BASED", "NON_ROUND_BASED"];
    console.log(`Round Mode: ${roundModeNames[roundMode]}`);

    // 2. Check deadlock strategy
    const deadlockStrategy = await contractService.getDeadlockStrategy();
    const deadlockNames = ["REVERT", "SKIP_ROUND"];
    console.log(`Deadlock Strategy: ${deadlockNames[deadlockStrategy]}`);

    // 3. Check eligible seeds count
    const eligibleSeedsCount = await contractService.getEligibleSeedsCount();
    console.log(`Eligible Seeds Count: ${eligibleSeedsCount}`);

    // 4. Check current round
    const currentRound = await contractService.getCurrentRound();
    console.log(`Current Round: ${currentRound}`);

    // 5. Check voting period status
    const timeRemaining = await contractService.getTimeUntilPeriodEnd();
    console.log(`Time Until Period End: ${timeRemaining}s`);
    console.log(`Voting Period Ended: ${timeRemaining === 0n ? 'YES' : 'NO'}`);

    // 6. Check current leader
    const leader = await contractService.getCurrentLeader();
    console.log(`Current Leader Seed ID: ${leader.leadingSeedId}`);
    console.log(`Current Leader Score: ${leader.score}`);

    // 7. Get seed count and check scores
    const seedCount = await contractService.getSeedCount();
    console.log(`Total Seeds: ${seedCount}\n`);

    // 8. Check scores for all eligible seeds
    console.log("Checking blessing scores for eligible seeds...");
    let seedsWithBlessings = 0;
    let seedsWithZeroBlessings = 0;

    // Get a sample of seeds to check their scores
    const totalSeeds = Number(seedCount);
    const samplesToCheck = Math.min(10, totalSeeds); // Check up to 10 seeds

    for (let i = 0; i < samplesToCheck; i++) {
      try {
        const seed = await contractService.getSeed(i);
        if (!seed.isWinner && !seed.isRetracted) {
          const score = await contractService.getSeedBlessingScore(i);
          console.log(`  Seed ${i}: blessings=${seed.blessings}, score=${score}, winner=${seed.isWinner}`);

          if (Number(score) > 0) {
            seedsWithBlessings++;
          } else {
            seedsWithZeroBlessings++;
          }
        }
      } catch (error) {
        // Seed might not exist
      }
    }

    console.log(`\nSample Results (checked ${samplesToCheck} seeds):`);
    console.log(`  Seeds with blessings: ${seedsWithBlessings}`);
    console.log(`  Seeds with 0 blessings: ${seedsWithZeroBlessings}`);

    // DIAGNOSIS
    console.log("\n" + "=".repeat(70));
    console.log("📊 DIAGNOSIS");
    console.log("=".repeat(70) + "\n");

    const isDeadlocked =
      roundMode === 1 && // NON_ROUND_BASED
      Number(eligibleSeedsCount) > 0 &&
      Number(leader.score) === 0;

    if (isDeadlocked) {
      console.log("❌ DEADLOCK CONFIRMED");
      console.log("\nProblem:");
      console.log("  - Mode: NON_ROUND_BASED");
      console.log("  - All eligible seeds have 0 blessing score");
      console.log("  - Contract won't select seeds with score = 0 (line 348 in TheSeeds.sol)");
      console.log("");
      console.log("Impact:");
      if (deadlockStrategy === 0) {
        console.log("  - selectDailyWinner() will REVERT (current strategy)");
        console.log("  - System is BLOCKED until at least one seed gets blessed");
      } else {
        console.log("  - selectDailyWinner() will SKIP_ROUND (current strategy)");
        console.log("  - This will create an INFINITE LOOP (skipping rounds won't help)");
      }
    } else {
      console.log("✅ NO DEADLOCK DETECTED");
      if (Number(leader.score) > 0) {
        console.log(`  - Leading seed ${leader.leadingSeedId} has score ${leader.score}`);
        console.log("  - Winner can be selected normally");
      }
    }

    // SOLUTIONS
    console.log("\n" + "=".repeat(70));
    console.log("💡 SOLUTIONS");
    console.log("=".repeat(70) + "\n");

    if (isDeadlocked) {
      console.log("Option 1: Get Blessings Cast (RECOMMENDED)");
      console.log("  - Have any user with FirstWorks NFT bless any eligible seed");
      console.log("  - This will give that seed a score > 0");
      console.log("  - Winner selection will then work normally");
      console.log("  - Command: POST /blessings/create with valid NFT ownership proof");
      console.log("");

      console.log("Option 2: Switch to ROUND_BASED Mode (WORKAROUND)");
      console.log("  - Change mode to ROUND_BASED");
      console.log("  - Submit new seeds in the current round");
      console.log("  - Those new seeds can be blessed");
      console.log("  - Command: POST /admin/config/round-mode {\"mode\": \"ROUND_BASED\"}");
      console.log("");

      console.log("Option 3: Change Deadlock Strategy to REVERT (SAFE)");
      console.log("  - If currently SKIP_ROUND, change to REVERT");
      console.log("  - This prevents infinite loop");
      console.log("  - System stays blocked but won't waste gas");
      console.log("  - Command: POST /admin/config/deadlock {\"strategy\": \"REVERT\"}");
      console.log("");

      console.log("⚠️  Contract Limitation:");
      console.log("  The contract code at line 348 requires score > 0");
      console.log("  This cannot be changed without upgrading the contract");
      console.log("  Therefore, at least ONE seed must receive blessings");
    }

    console.log("\n" + "=".repeat(70));
    console.log("🔧 RECOMMENDED ACTION");
    console.log("=".repeat(70) + "\n");

    if (isDeadlocked) {
      console.log("STEP 1: Ensure deadlock strategy is REVERT (prevents infinite loop)");
      if (deadlockStrategy === 1) {
        console.log("  ⚠️  Currently: SKIP_ROUND");
        console.log("  ✅ Run: POST /admin/config/deadlock {\"strategy\": \"REVERT\"}");
      } else {
        console.log("  ✅ Already: REVERT");
      }
      console.log("");

      console.log("STEP 2: Get at least one blessing cast");
      console.log("  - Contact FirstWorks NFT holders");
      console.log("  - Ask them to bless any seed they like");
      console.log("  - Use the /blessings API endpoint");
      console.log("  - Once any seed has blessings, winner selection will work");
      console.log("");

      console.log("STEP 3: Monitor and select winner");
      console.log("  - Check diagnostics: GET /admin/winner-diagnostics");
      console.log("  - When ready: POST /admin/select-winner");
    } else {
      console.log("No deadlock detected. You can proceed with winner selection:");
      console.log("  POST /admin/select-winner");
    }

    console.log("\n" + "=".repeat(70) + "\n");

  } catch (error) {
    console.error("❌ Error during diagnosis:", error);
    throw error;
  }
}

// Run diagnosis
diagnoseDeadlock()
  .then(() => {
    console.log("✅ Diagnosis complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Diagnosis failed:", error);
    process.exit(1);
  });
