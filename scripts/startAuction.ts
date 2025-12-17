/**
 * Script to start an auction for a specific Abraham creation token
 */

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { abrahamService } from '../src/services/abrahamService.js';

async function startAuction() {
  const tokenId = process.argv[2] ? parseInt(process.argv[2]) : 1;
  const durationInDays = process.argv[3] ? parseFloat(process.argv[3]) : 1;
  const minBidInEth = process.argv[4] || '0.01';

  console.log('\n🎨 Starting auction for Abraham creation...\n');
  console.log(`Token ID: ${tokenId}`);
  console.log(`Duration: ${durationInDays} day(s)`);
  console.log(`Min Bid: ${minBidInEth} ETH\n`);

  // Check if service is configured
  if (!abrahamService.isConfigured()) {
    console.error('❌ Abraham service not configured');
    console.error('   Make sure these environment variables are set:');
    console.error('   - PRIVATE_KEY');
    console.error('   - ABRAHAM_COVENANT_ADDRESS');
    console.error('   - ABRAHAM_AUCTION_ADDRESS');
    console.error('   - SEPOLIA_RPC_URL');
    process.exit(1);
  }

  try {
    console.log('📤 Creating auction on Ethereum Sepolia...\n');

    const result = await abrahamService.createDailyAuction(
      tokenId,
      durationInDays,
      minBidInEth
    );

    if (result.success) {
      console.log('\n' + '═'.repeat(70));
      console.log('✅ AUCTION CREATED SUCCESSFULLY');
      console.log('═'.repeat(70));
      console.log(`   Token ID: ${tokenId}`);
      console.log(`   Auction ID: ${result.auctionId}`);
      console.log(`   Tx Hash: ${result.txHash}`);
      console.log(`   Duration: ${durationInDays} day(s)`);
      console.log(`   Min Bid: ${minBidInEth} ETH`);
      console.log(`\n🔗 View Transaction:`);
      console.log(`   https://sepolia.etherscan.io/tx/${result.txHash}`);
      console.log(`\n🎯 View Auction:`);
      console.log(`   Run: npx tsx scripts/checkAuction.ts ${tokenId}`);
      console.log('═'.repeat(70) + '\n');
    } else {
      console.error('\n❌ Failed to create auction');
      console.error(`   Error: ${result.error}`);
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the script
startAuction()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
