/**
 * Script to select the daily winner and start a new round
 * This resets the blessing period and allows new blessings
 */

import { contractService } from '../src/services/contractService.js';

async function selectWinner() {
  console.log('\n' + '='.repeat(70));
  console.log('🏆 SELECTING DAILY WINNER');
  console.log('='.repeat(70) + '\n');

  // Check if service is configured
  if (!contractService.canSubmitBlessings()) {
    console.error('❌ Contract service not configured');
    console.error('   Make sure RELAYER_PRIVATE_KEY is set in .env.local');
    process.exit(1);
  }

  console.log('📊 Checking current state...');

  try {
    // Get current round info
    const currentRound = await contractService.getCurrentRound();
    const timeRemaining = await contractService.getTimeUntilPeriodEnd();

    console.log(`   Current Round: ${currentRound}`);
    console.log(`   Time Remaining: ${timeRemaining}s (${Number(timeRemaining) / 3600} hours)`);
    console.log('');

    if (timeRemaining > 0n) {
      console.log('⚠️  WARNING: Voting period has not ended yet');
      console.log(`   ${Number(timeRemaining)} seconds remaining (${(Number(timeRemaining) / 3600).toFixed(2)} hours)`);
      console.log('');
      console.log('Do you want to continue anyway? (This will fail if contract enforces period end)');
      console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log('');
    }

    console.log('🔍 Running pre-flight diagnostics and selecting winner...');
    console.log('');

    const result = await contractService.selectDailyWinner();

    if (!result.success) {
      console.error('❌ Failed to select winner');
      console.error(`   Error: ${result.error}`);
      if (result.diagnostics) {
        console.log('');
        console.log('📊 Diagnostics:');
        console.log(`   Current Round: ${result.diagnostics.currentRound}`);
        console.log(`   Seeds in Round: ${result.diagnostics.seedsInRound}`);
        console.log(`   Time Remaining: ${result.diagnostics.timeRemaining}s`);
        console.log(`   Current Leader: Seed #${result.diagnostics.currentLeader.seedId} (score: ${result.diagnostics.currentLeader.score})`);
      }
      process.exit(1);
    }

    console.log('✅ Winner selected successfully!');
    console.log('');
    console.log('📊 Results:');
    console.log(`   Winning Seed ID: ${result.winningSeedId}`);
    console.log(`   Previous Round: ${currentRound}`);
    console.log(`   New Round: ${Number(currentRound) + 1}`);

    if (result.txHash) {
      const blockExplorer = process.env.NETWORK === 'base'
        ? `https://basescan.org/tx/${result.txHash}`
        : `https://sepolia.basescan.org/tx/${result.txHash}`;
      console.log(`   Transaction: ${result.txHash}`);
      console.log(`   🔗 View: ${blockExplorer}`);
    }

    if (result.diagnostics) {
      console.log('');
      console.log('📊 Round Summary:');
      console.log(`   Total Seeds: ${result.diagnostics.seedsInRound}`);
      console.log(`   Winning Score: ${result.diagnostics.currentLeader.score}`);
    }

    console.log('');
    console.log('='.repeat(70));
    console.log('✅ NEW ROUND STARTED - BLESSING PERIOD RESET');
    console.log('='.repeat(70));
    console.log('');
    console.log('Next steps:');
    console.log('1. Users can now bless seeds again');
    console.log('2. Consider switching to non-round-based mode: npm run switch-non-round');
    console.log('3. Consider extending voting period: npm run extend-voting');
    console.log('');

  } catch (error: any) {
    console.error('❌ Error selecting winner:', error.message);
    if (error.cause) {
      console.error('   Cause:', error.cause);
    }
    process.exit(1);
  }
}

selectWinner()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  });
