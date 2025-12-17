/**
 * Reset voting period back to 24 hours (1 day)
 */

import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const SEEDS_ABI = JSON.parse(readFileSync('./lib/abi/TheSeeds.json', 'utf-8'));

async function resetVotingPeriod() {
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
  console.log('🔧 RESETTING VOTING PERIOD TO 24 HOURS');
  console.log('='.repeat(70) + '\n');

  // Check current state
  console.log('📊 Current state:');
  const currentPeriod = await publicClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: SEEDS_ABI,
    functionName: 'votingPeriod',
    args: [],
  }) as bigint;

  const periodStart = await publicClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: SEEDS_ABI,
    functionName: 'currentVotingPeriodStart',
    args: [],
  }) as bigint;

  const timeRemaining = await publicClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: SEEDS_ABI,
    functionName: 'getTimeUntilPeriodEnd',
    args: [],
  }) as bigint;

  console.log(`   Current voting period: ${Number(currentPeriod) / 86400} days`);
  console.log(`   Period started: ${new Date(Number(periodStart) * 1000).toISOString()}`);
  console.log(`   Time remaining: ${(Number(timeRemaining) / 3600).toFixed(2)} hours`);
  console.log('');

  // Reset to 1 day (24 hours)
  const oneDay = BigInt(24 * 60 * 60);

  console.log('📝 Updating voting period to 1 day (24 hours)...');
  console.log('   Note: Since the period started 31+ hours ago, this will close voting');
  console.log('');

  const hash = await walletClient.writeContract({
    address: contractAddress as `0x${string}`,
    abi: SEEDS_ABI,
    functionName: 'updateVotingPeriod',
    args: [oneDay],
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
  console.log(`   Time remaining: ${Number(newTimeRemaining)} seconds`);
  console.log('');

  const blockExplorer = `https://sepolia.basescan.org/tx/${hash}`;
  console.log(`🔗 View on BaseScan: ${blockExplorer}`);
  console.log('');

  if (Number(newTimeRemaining) === 0) {
    console.log('='.repeat(70));
    console.log('✅ VOTING PERIOD CLOSED - READY TO SELECT WINNER!');
    console.log('='.repeat(70));
  } else {
    console.log('⚠️  Voting period still active');
    console.log(`   Wait ${(Number(newTimeRemaining) / 3600).toFixed(2)} hours before selecting winner`);
  }
  console.log('');
}

resetVotingPeriod()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
