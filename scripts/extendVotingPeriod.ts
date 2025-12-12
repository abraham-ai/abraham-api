/**
 * Emergency script to extend voting period
 * This extends the current voting period to unblock blessing
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

async function extendVotingPeriod() {
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
  console.log('🔧 EXTENDING VOTING PERIOD TO UNBLOCK BLESSING');
  console.log('='.repeat(70) + '\n');

  // Check current state
  console.log('📊 Current state:');
  const currentPeriod = await publicClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: SEEDS_ABI,
    functionName: 'votingPeriod',
    args: [],
  }) as bigint;

  const timeRemaining = await publicClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: SEEDS_ABI,
    functionName: 'getTimeUntilPeriodEnd',
    args: [],
  }) as bigint;

  console.log(`   Current voting period: ${Number(currentPeriod) / 86400} days`);
  console.log(`   Time remaining: ${Number(timeRemaining)} seconds`);
  console.log('');

  // Extend to 7 days (max allowed by contract)
  const sevenDays = BigInt(7 * 24 * 60 * 60);

  console.log('📝 Updating voting period to 7 days (max allowed)...');
  console.log('   This will retroactively extend the current blessing period');
  console.log('');

  const hash = await walletClient.writeContract({
    address: contractAddress as `0x${string}`,
    abi: SEEDS_ABI,
    functionName: 'updateVotingPeriod',
    args: [sevenDays],
  });

  console.log('✅ Transaction sent:', hash);
  console.log('⏳ Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log('✅ Transaction confirmed!');
  console.log(`   Block: ${receipt.blockNumber}`);
  console.log(`   Status: ${receipt.status}`);
  console.log('');

  // Verify new state
  const newPeriod = await publicClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: SEEDS_ABI,
    functionName: 'votingPeriod',
    args: [],
  }) as bigint;

  const newTimeRemaining = await publicClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: SEEDS_ABI,
    functionName: 'getTimeUntilPeriodEnd',
    args: [],
  }) as bigint;

  console.log('📊 New state:');
  console.log(`   Voting period: ${Number(newPeriod) / 86400} days`);
  console.log(`   Time remaining: ${(Number(newTimeRemaining) / 3600).toFixed(2)} hours`);
  console.log('');

  const blockExplorer = `https://sepolia.basescan.org/tx/${hash}`;
  console.log(`🔗 View on BaseScan: ${blockExplorer}`);
  console.log('');

  console.log('='.repeat(70));
  console.log('✅ VOTING PERIOD EXTENDED - YOU CAN NOW BLESS SEED ID 1!');
  console.log('='.repeat(70));
  console.log('');
  console.log('Next steps:');
  console.log('1. Bless Seed ID 1');
  console.log('2. After blessing, set voting period back to 1 day if desired');
  console.log('   (use this script with different duration)');
  console.log('');
}

extendVotingPeriod()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
