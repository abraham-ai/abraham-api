/**
 * Test script for creating a commandment directly
 * Bypasses API authentication to test IPFS integration
 */

import 'dotenv/config';
import { commandmentService } from './src/services/commandmentService.js';

async function testCommandment() {
  console.log('🧪 Testing commandment creation...\n');

  // Test wallet address (FirstWorks holder)
  const testWalletAddress = '0x826be0f079a18c7f318efbead5f90df70a7b2e29';
  const seedId = 0;
  const message = 'Testing IPFS commandment upload with Pinata! This should work now! 🚀';

  console.log(`📝 Creating commandment:`);
  console.log(`   Wallet: ${testWalletAddress}`);
  console.log(`   Seed ID: ${seedId}`);
  console.log(`   Message: ${message}\n`);

  try {
    const result = await commandmentService.submitCommandment(
      testWalletAddress,
      seedId,
      message
    );

    if (result.success) {
      console.log('✅ Commandment created successfully!\n');
      console.log(`📋 Results:`);
      console.log(`   Commandment ID: ${result.commandmentId}`);
      console.log(`   IPFS Hash: ${result.ipfsHash}`);
      console.log(`   Transaction: ${result.txHash}`);
      console.log(`   Block Explorer: https://sepolia.basescan.org/tx/${result.txHash}\n`);

      // Now test fetching it back
      console.log('🔍 Fetching commandments for seed 0...\n');
      const commandments = await commandmentService.getCommandmentsBySeed(seedId);

      console.log(`Found ${commandments.length} commandment(s):`);
      commandments.forEach((cmd, index) => {
        console.log(`\n${index + 1}. Commandment #${cmd.id}`);
        console.log(`   Author: ${cmd.author}`);
        console.log(`   IPFS Hash: ${cmd.ipfsHash}`);
        console.log(`   Created At: ${new Date(cmd.createdAt * 1000).toISOString()}`);
        if (cmd.metadata) {
          console.log(`   ✅ Metadata loaded successfully:`);
          console.log(`      Message: ${cmd.metadata.message}`);
          console.log(`      Type: ${cmd.metadata.type}`);
          console.log(`      Version: ${cmd.metadata.version}`);
        } else if (cmd.metadataError) {
          console.log(`   ❌ Metadata Error: ${cmd.metadataError}`);
        }
      });
    } else {
      console.error('❌ Failed to create commandment');
      console.error(`   Error: ${result.error}`);
    }
  } catch (error) {
    console.error('💥 Error during test:', error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    }
  }

  process.exit(0);
}

testCommandment();
