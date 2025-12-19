/**
 * Test script to verify getCurrentLeader fix
 */

import * as dotenv from 'dotenv';

// Load environment variables BEFORE importing services
dotenv.config({ path: '.env.local' });
dotenv.config();

import { contractService } from '../src/services/contractService.js';

async function testGetCurrentLeader() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 TESTING getCurrentLeader FIX');
  console.log('='.repeat(70) + '\n');

  try {
    console.log('📊 Testing getCurrentLeader()...');
    const leader = await contractService.getCurrentLeader();

    console.log(`✅ Function call successful!`);
    console.log(`   Leading Seed ID: ${leader.leadingSeedId}`);
    console.log(`   Score: ${leader.score}`);
    console.log('');

    console.log('📊 Testing getCurrentLeaders() directly...');
    const leaders = await contractService.getCurrentLeaders();

    console.log(`✅ Function call successful!`);
    console.log(`   Leading Seed IDs: ${leaders.leadingSeedIds.join(', ')}`);
    console.log(`   Score: ${leaders.score}`);
    console.log('');

    console.log('✅ Both functions work correctly!');
    console.log('');

    // Verify consistency
    if (leaders.leadingSeedIds.length > 0) {
      if (leader.leadingSeedId === leaders.leadingSeedIds[0]) {
        console.log('✅ getCurrentLeader returns first leader correctly');
      } else {
        console.error('❌ Mismatch between getCurrentLeader and getCurrentLeaders');
      }
    }

    if (leader.score === leaders.score) {
      console.log('✅ Scores match correctly');
    } else {
      console.error('❌ Score mismatch');
    }

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ TEST COMPLETE');
  console.log('='.repeat(70) + '\n');
}

testGetCurrentLeader()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  });
