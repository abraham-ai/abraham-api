/**
 * Script to switch contract to NON_ROUND_BASED mode
 * This allows all eligible seeds to receive blessings (not just current round seeds)
 */

import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

// Load environment
dotenv.config({ path: '.env.local' });
dotenv.config();

const SEEDS_ABI = JSON.parse(readFileSync('./lib/abi/TheSeeds.json', 'utf-8'));

async function switchToNonRoundBased() {
  const privateKey = process.env.PRIVATE_KEY;
  const rpcUrl = process.env.L2_RPC_URL;
  const contractAddress = process.env.L2_SEEDS_CONTRACT;

  if (!privateKey || !rpcUrl || !contractAddress) {
    throw new Error('Missing environment variables');
  }

  const account = privateKeyToAccount(
    (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`
  );

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  console.log('\n' + '='.repeat(70));
  console.log('🔧 SWITCHING TO NON-ROUND BASED MODE');
  console.log('='.repeat(70) + '\n');

  // Check current state
  console.log('📊 Current state:');
  const currentMode = await publicClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: SEEDS_ABI,
    functionName: 'getRoundMode',
    args: [],
  }) as number;

  const modeNames = ['ROUND_BASED', 'NON_ROUND_BASED'];
  console.log(`   Current mode: ${modeNames[currentMode]}`);
  console.log('');

  if (currentMode === 1) {
    console.log('✅ Already in NON_ROUND_BASED mode!');
    console.log('');
    return;
  }

  // Switch to NON_ROUND_BASED (enum value = 1)
  const NON_ROUND_BASED = 1;

  console.log('📝 Switching to NON_ROUND_BASED mode...');
  console.log('   This will allow all eligible seeds to receive blessings');
  console.log('   (not just seeds submitted in the current round)');
  console.log('');

  const hash = await walletClient.writeContract({
    address: contractAddress as `0x${string}`,
    abi: SEEDS_ABI,
    functionName: 'updateRoundMode',
    args: [NON_ROUND_BASED],
  });

  console.log('✅ Transaction sent:', hash);
  console.log('⏳ Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log('✅ Transaction confirmed!');
  console.log(`   Block: ${receipt.blockNumber}`);
  console.log(`   Status: ${receipt.status}`);
  console.log('');

  // Verify new state
  const newMode = await publicClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: SEEDS_ABI,
    functionName: 'getRoundMode',
    args: [],
  }) as number;

  console.log('📊 New state:');
  console.log(`   Mode: ${modeNames[newMode]}`);
  console.log('');

  const blockExplorer = `https://sepolia.basescan.org/tx/${hash}`;
  console.log(`🔗 View on BaseScan: ${blockExplorer}`);
  console.log('');

  console.log('='.repeat(70));
  console.log('✅ SWITCHED TO NON-ROUND BASED MODE');
  console.log('='.repeat(70));
  console.log('');
  console.log('What this means:');
  console.log('✓ All eligible seeds can receive blessings (not just current round)');
  console.log('✓ Winner selection considers all seeds, not just current round seeds');
  console.log('⚠️  Blessing period time limit still applies');
  console.log('');
  console.log('Next steps:');
  console.log('1. Consider extending voting period to 7 days for continuous voting');
  console.log('   Run: npm run extend-voting-period');
  console.log('2. Set up automated winner selection to reset blessing periods');
  console.log('');
}

switchToNonRoundBased()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
