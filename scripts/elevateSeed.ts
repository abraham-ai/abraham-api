/**
 * Script to elevate a winning seed to Abraham creation and start auction
 */

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { contractService } from '../src/services/contractService.js';
import { abrahamService } from '../src/services/abrahamService.js';

async function elevateSeed() {
  const seedId = process.argv[2] ? parseInt(process.argv[2]) : 2;

  console.log('\n' + '═'.repeat(70));
  console.log('🌟 ELEVATING WINNING SEED TO ABRAHAM CREATION');
  console.log('═'.repeat(70));
  console.log(`   Seed ID: ${seedId}`);
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log('═'.repeat(70) + '\n');

  try {
    // Check if Abraham service is configured
    if (!abrahamService.isConfigured()) {
      console.error('❌ Abraham service not configured');
      console.error('   Make sure these environment variables are set:');
      console.error('   - PRIVATE_KEY');
      console.error('   - ABRAHAM_COVENANT_ADDRESS');
      console.error('   - ABRAHAM_AUCTION_ADDRESS');
      console.error('   - SEPOLIA_RPC_URL');
      process.exit(1);
    }

    // Fetch seed details
    console.log('📍 Fetching seed details from TheSeeds contract...\n');
    let seed;
    try {
      seed = await contractService.getSeed(seedId);
    } catch (error) {
      console.error(`❌ Failed to fetch seed ${seedId}:`, error instanceof Error ? error.message : error);
      process.exit(1);
    }

    // Verify seed is a winner
    if (!seed.isWinner) {
      console.error(`❌ Seed ${seedId} is not a winner`);
      console.error('   Only winning seeds can be elevated to Abraham creations');
      process.exit(1);
    }

    // Verify seed has IPFS hash
    if (!seed.ipfsHash || seed.ipfsHash.trim() === '') {
      console.error(`❌ Seed ${seedId} has no IPFS hash`);
      console.error('   Cannot elevate seed without metadata');
      process.exit(1);
    }

    console.log('✅ Seed details retrieved:');
    console.log(`   IPFS Hash: ${seed.ipfsHash}`);
    console.log(`   Creator: ${seed.creator}`);
    console.log(`   Blessings: ${seed.blessings}`);
    console.log(`   Winner in Round: ${seed.winnerInRound}\n`);

    // Check if already committed today
    const hasCommitted = await abrahamService.hasCommittedToday();
    if (hasCommitted) {
      console.error('❌ Already committed an Abraham creation today');
      console.error('   Can only mint one creation per day (UTC)');
      console.error('   Wait until tomorrow to elevate another seed\n');
      process.exit(1);
    }

    console.log('✅ Ready to elevate (no creation minted today)\n');

    // Elevate the seed
    console.log('📤 Elevating seed to Abraham creation...\n');

    const result = await abrahamService.elevateSeedToCreation(
      {
        id: seedId,
        ipfsHash: seed.ipfsHash,
        creator: seed.creator,
        blessings: Number(seed.blessings),
      },
      Number(seed.winnerInRound)
    );

    if (!result.success) {
      console.error('\n❌ Elevation failed:');
      console.error(`   ${result.error}\n`);
      process.exit(1);
    }

    // Success!
    console.log('\n' + '═'.repeat(70));
    console.log('✅ ELEVATION SUCCESSFUL');
    console.log('═'.repeat(70));
    console.log('\n🎨 ABRAHAM CREATION DETAILS:');
    console.log(`   Token ID: ${result.tokenId}`);
    console.log(`   Auction ID: ${result.auctionId}`);
    console.log(`   Metadata: ${seed.ipfsHash}`);
    console.log(`   Creator: ${seed.creator}`);

    console.log('\n📝 TRANSACTION DETAILS:');
    console.log(`   Mint Tx: ${result.mintTxHash}`);
    console.log(`   Auction Tx: ${result.auctionTxHash}`);

    console.log('\n🔗 BLOCK EXPLORERS:');
    console.log(`   Mint: https://sepolia.etherscan.io/tx/${result.mintTxHash}`);
    console.log(`   Auction: https://sepolia.etherscan.io/tx/${result.auctionTxHash}`);

    console.log('\n🎯 VERIFY:');
    console.log(`   Check creation: npx tsx scripts/checkAbrahamCreations.ts`);
    console.log(`   Check auction: npx tsx scripts/checkAuction.ts ${result.tokenId}`);

    console.log('\n' + '═'.repeat(70) + '\n');

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the script
elevateSeed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
