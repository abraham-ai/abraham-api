/**
 * Test script for the automated elevation flow via API
 *
 * This script tests the select-winner endpoint with autoElevate=true
 * which replicates what the cron job does daily at 00:00 UTC
 */

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const ADMIN_KEY = process.env.ADMIN_KEY || 'father-abraham';

async function testElevationFlow() {
  console.log('\n' + '═'.repeat(70));
  console.log('🧪 TESTING AUTOMATED ELEVATION FLOW');
  console.log('═'.repeat(70));
  console.log(`   API URL: ${API_BASE_URL}`);
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log('═'.repeat(70) + '\n');

  try {
    // Step 1: Check winner diagnostics first
    console.log('📍 STEP 1: Checking winner diagnostics...\n');

    const diagnosticsResponse = await fetch(
      `${API_BASE_URL}/api/admin/winner-diagnostics`,
      {
        headers: {
          'X-Admin-Key': ADMIN_KEY,
        },
      }
    );

    const diagnostics = await diagnosticsResponse.json();

    if (!diagnosticsResponse.ok) {
      console.error('❌ Failed to get diagnostics');
      console.error(JSON.stringify(diagnostics, null, 2));
      process.exit(1);
    }

    console.log('📊 Diagnostics:');
    console.log(`   Ready: ${diagnostics.ready ? '✅ YES' : '❌ NO'}`);
    console.log(`   Current Round: ${diagnostics.diagnostics.currentRound}`);
    console.log(`   Seeds in Round: ${diagnostics.diagnostics.seedsInRound}`);
    console.log(`   Time Remaining: ${diagnostics.diagnostics.timeRemaining}s`);
    console.log(`   Voting Period Ended: ${diagnostics.diagnostics.votingPeriodEnded ? 'YES' : 'NO'}`);
    console.log(`   Leader Seed ID: ${diagnostics.diagnostics.currentLeader.seedId}`);
    console.log(`   Leader Score: ${diagnostics.diagnostics.currentLeader.score}`);
    console.log(`   Leader Blessings: ${diagnostics.diagnostics.currentLeader.blessings}`);

    if (diagnostics.issues && diagnostics.issues.length > 0) {
      console.log('\n⚠️  Issues:');
      diagnostics.issues.forEach((issue: string) => console.log(`   - ${issue}`));
    }

    console.log('');

    if (!diagnostics.ready) {
      console.log('⚠️  System not ready for winner selection yet.');
      console.log('   Wait until voting period ends or resolve issues above.\n');
      return;
    }

    // Step 2: Select winner with auto-elevation
    console.log('📍 STEP 2: Selecting winner with auto-elevation...\n');

    const winnerResponse = await fetch(
      `${API_BASE_URL}/api/admin/select-winner?autoElevate=true`,
      {
        method: 'POST',
        headers: {
          'X-Admin-Key': ADMIN_KEY,
        },
      }
    );

    const result = await winnerResponse.json();

    if (!winnerResponse.ok) {
      console.error('❌ Winner selection failed');
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }

    console.log('\n' + '═'.repeat(70));
    console.log('✅ AUTOMATED FLOW COMPLETED SUCCESSFULLY');
    console.log('═'.repeat(70));

    console.log('\n📦 WINNER DETAILS:');
    console.log(`   Seed ID: ${result.data.winningSeedId}`);
    console.log(`   Round: ${result.data.round}`);
    console.log(`   IPFS Hash: ${result.data.seed.ipfsHash}`);
    console.log(`   Creator: ${result.data.seed.creator}`);
    console.log(`   Blessings: ${result.data.seed.blessings}`);
    console.log(`   Winner Selection Tx: ${result.data.txHash}`);
    console.log(`   Block Explorer: ${result.data.blockExplorer}`);

    if (result.data.abraham) {
      console.log('\n🎨 ABRAHAM CREATION:');
      console.log(`   Token ID: ${result.data.abraham.tokenId}`);
      console.log(`   Auction ID: ${result.data.abraham.auctionId}`);
      console.log(`   Mint Tx: ${result.data.abraham.mintTxHash}`);
      console.log(`   Auction Tx: ${result.data.abraham.auctionTxHash}`);
      console.log(`\n🔗 View Transactions:`);
      console.log(`   Mint: ${result.data.abraham.mintExplorer}`);
      console.log(`   Auction: ${result.data.abraham.auctionExplorer}`);

      console.log('\n🎯 VERIFY AUCTION:');
      console.log(`   Run: npx tsx scripts/checkAuction.ts ${result.data.abraham.tokenId}`);
    }

    console.log('\n' + '═'.repeat(70));
    console.log(`⏰ Timestamp: ${result.data.timestamp}`);
    console.log('═'.repeat(70) + '\n');

  } catch (error) {
    console.error('\n❌ Error testing elevation flow:', error);
    process.exit(1);
  }
}

// Run the test
testElevationFlow()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
