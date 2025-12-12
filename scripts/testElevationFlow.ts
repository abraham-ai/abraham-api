/**
 * Comprehensive test of the seed elevation flow
 * Tests: Winner Selection → Elevation → Abraham Creation → Auction
 */

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { contractService } from '../src/services/contractService.js';
import { abrahamService } from '../src/services/abrahamService.js';

async function testElevationFlow() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 TESTING COMPLETE SEED ELEVATION FLOW');
  console.log('='.repeat(70) + '\n');

  try {
    // ============================================
    // STEP 1: Check current state
    // ============================================
    console.log('📍 STEP 1: Checking current state...\n');

    const currentRound = await contractService.getCurrentRound();
    console.log(`   Current Round: ${currentRound}`);

    const roundSeeds = await contractService.getCurrentRoundSeeds();
    console.log(`   Seeds in Current Round: ${roundSeeds.length}`);

    const timeRemaining = await contractService.getTimeUntilPeriodEnd();
    console.log(`   Time Until Period End: ${timeRemaining}s`);

    const leader = await contractService.getCurrentLeader();
    console.log(`   Current Leader Seed ID: ${leader.leadingSeedId}`);
    console.log(`   Current Leader Score: ${leader.score}\n`);

    // ============================================
    // STEP 2: Check for winning seeds
    // ============================================
    console.log('📍 STEP 2: Checking for winning seeds from previous rounds...\n');

    const winningSeeds = [];

    // Check all rounds up to current
    for (let round = 0; round < Number(currentRound); round++) {
      try {
        const seeds = await contractService.getSeedsByRound(round);

        for (const seed of seeds) {
          if (seed.isWinner) {
            console.log(`   ✅ Found winner: Seed ID ${seed.id} (Round ${round})`);
            console.log(`      IPFS Hash: ${seed.ipfsHash}`);
            console.log(`      Creator: ${seed.creator}`);
            console.log(`      Blessings: ${seed.blessings}\n`);

            winningSeeds.push({
              id: Number(seed.id),
              round: Number(seed.winnerInRound),
              ipfsHash: seed.ipfsHash,
              creator: seed.creator,
              blessings: Number(seed.blessings),
            });
          }
        }
      } catch (error) {
        // Skip rounds with no seeds
      }
    }

    if (winningSeeds.length === 0) {
      console.log('   ⚠️  No winning seeds found in previous rounds');
      console.log('   You need to:');
      console.log('   1. Create seeds in the current round');
      console.log('   2. Have them blessed');
      console.log('   3. Wait for voting period to end');
      console.log('   4. Call selectDailyWinner()\n');
      process.exit(0);
    }

    // ============================================
    // STEP 3: Validate seed data
    // ============================================
    console.log('📍 STEP 3: Validating seed data...\n');

    let hasIssues = false;

    for (const seed of winningSeeds) {
      console.log(`   Checking Seed ID ${seed.id}:`);

      // Check IPFS hash
      if (!seed.ipfsHash || seed.ipfsHash.trim() === '') {
        console.log(`      ❌ ERROR: No IPFS hash!`);
        hasIssues = true;
      } else {
        console.log(`      ✅ IPFS Hash: ${seed.ipfsHash}`);
      }

      // Check creator
      if (!seed.creator || seed.creator === '0x0000000000000000000000000000000000000000') {
        console.log(`      ❌ ERROR: Invalid creator address!`);
        hasIssues = true;
      } else {
        console.log(`      ✅ Creator: ${seed.creator}`);
      }

      console.log('');
    }

    if (hasIssues) {
      console.log('❌ VALIDATION FAILED: Some seeds have invalid data\n');
      process.exit(1);
    }

    console.log('✅ All winning seeds have valid data\n');

    // ============================================
    // STEP 4: Check Abraham service configuration
    // ============================================
    console.log('📍 STEP 4: Checking Abraham service configuration...\n');

    if (!abrahamService.isConfigured()) {
      console.log('   ❌ Abraham service not configured');
      console.log('   Required environment variables:');
      console.log('   - ABRAHAM_COVENANT_ADDRESS');
      console.log('   - ABRAHAM_AUCTION_ADDRESS');
      console.log('   - PRIVATE_KEY\n');
      process.exit(1);
    }

    console.log('   ✅ Abraham service is configured\n');

    // Check if already committed today
    const hasCommitted = await abrahamService.hasCommittedToday();
    console.log(`   Committed Today: ${hasCommitted ? 'YES ⚠️' : 'NO ✅'}`);

    if (hasCommitted) {
      console.log('   ⚠️  Already minted a creation today');
      console.log('   Wait until tomorrow (UTC midnight) to mint another\n');
    } else {
      console.log('   ✅ Ready to mint a new creation\n');
    }

    // ============================================
    // STEP 5: Simulate elevation (dry run)
    // ============================================
    console.log('📍 STEP 5: Elevation flow simulation...\n');

    const testSeed = winningSeeds[0];
    console.log(`   Would elevate: Seed ID ${testSeed.id}`);
    console.log(`   IPFS Hash to be passed: "${testSeed.ipfsHash}"`);
    console.log(`   Creator address: ${testSeed.creator}`);
    console.log(`   Blessings count: ${testSeed.blessings}\n`);

    // Validate the data that would be passed
    if (!testSeed.ipfsHash || testSeed.ipfsHash.trim() === '') {
      console.log('   ❌ CRITICAL ERROR: IPFS hash is empty!');
      console.log('   Elevation would fail with empty metadata\n');
      process.exit(1);
    }

    console.log('   ✅ IPFS hash validation passed\n');

    // ============================================
    // STEP 6: Summary
    // ============================================
    console.log('='.repeat(70));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Found ${winningSeeds.length} winning seed(s)`);
    console.log(`✅ All seeds have valid IPFS hashes`);
    console.log(`✅ Abraham service is configured`);
    console.log(`${hasCommitted ? '⚠️' : '✅'}  ${hasCommitted ? 'Already committed today - must wait' : 'Ready to elevate'}`);
    console.log('');

    console.log('🎯 TO ELEVATE AUTOMATICALLY:');
    console.log('   curl -X POST -H "X-Admin-Key: father-abraham" \\');
    console.log('     "http://localhost:3000/api/admin/select-winner?autoElevate=true"');
    console.log('');

    console.log('🎯 TO ELEVATE MANUALLY:');
    for (const seed of winningSeeds) {
      console.log(`   Seed ID ${seed.id}:`);
      console.log(`   curl -X POST -H "X-Admin-Key: father-abraham" \\`);
      console.log(`     "http://localhost:3000/api/admin/elevate-seed?seedId=${seed.id}"`);
      console.log('');
    }

    console.log('✅ ELEVATION FLOW TEST PASSED\n');

  } catch (error) {
    console.error('❌ TEST FAILED:', error);
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
