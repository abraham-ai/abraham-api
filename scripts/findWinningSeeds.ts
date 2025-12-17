/**
 * Script to find all winning seeds across all rounds
 * This helps identify seeds that won but haven't been elevated yet
 */

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { contractService } from '../src/services/contractService.js';

async function findWinningSeeds() {
  console.log('\n🔍 Searching for winning seeds...\n');

  try {
    // Get current round
    const currentRound = await contractService.getCurrentRound();
    console.log(`Current Round: ${currentRound}`);
    console.log(`Checking rounds 0 to ${Number(currentRound) - 1}...\n`);

    const winningSeeds = [];

    // Check all rounds up to current
    for (let round = 0; round < Number(currentRound); round++) {
      try {
        const seeds = await contractService.getSeedsByRound(round);

        if (seeds.length > 0) {
          console.log(`\n📦 Round ${round}: Found ${seeds.length} seed(s)`);

          // Find winners in this round
          for (const seed of seeds) {
            if (seed.isWinner) {
              console.log(`  ✅ WINNER: Seed ID ${seed.id}`);
              console.log(`     Creator: ${seed.creator}`);
              console.log(`     IPFS Hash: ${seed.ipfsHash}`);
              console.log(`     Blessings: ${seed.blessings}`);
              console.log(`     Winner in Round: ${seed.winnerInRound}`);

              winningSeeds.push({
                id: Number(seed.id),
                round: Number(seed.winnerInRound),
                creator: seed.creator,
                ipfsHash: seed.ipfsHash,
                blessings: Number(seed.blessings),
              });
            } else {
              console.log(`  ⏸️  Seed ID ${seed.id} (not winner)`);
            }
          }
        } else {
          console.log(`Round ${round}: No seeds`);
        }
      } catch (error) {
        console.log(`Round ${round}: Error fetching seeds -`, error instanceof Error ? error.message : error);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Winning Seeds: ${winningSeeds.length}`);

    if (winningSeeds.length > 0) {
      console.log('\n🏆 All Winning Seeds:');
      console.table(winningSeeds);

      console.log('\n📝 To elevate any of these seeds, use:');
      console.log('━'.repeat(60));
      for (const seed of winningSeeds) {
        console.log(`\nSeed ID ${seed.id} (Round ${seed.round}):`);
        console.log(`curl -X POST -H "X-Admin-Key: father-abraham" \\`);
        console.log(`  "http://localhost:3000/api/admin/elevate-seed?seedId=${seed.id}"`);
      }
      console.log('');
    } else {
      console.log('\n⚠️  No winning seeds found in any round.');
      console.log('You need to:');
      console.log('1. Create seeds in the current round');
      console.log('2. Have them blessed by FirstWorks NFT holders');
      console.log('3. Wait for the 24-hour voting period to end');
      console.log('4. Call POST /api/admin/select-winner');
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
findWinningSeeds()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
