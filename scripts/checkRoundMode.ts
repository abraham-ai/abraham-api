/**
 * Quick script to check current round mode
 */

import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

// Load environment
dotenv.config({ path: '.env.local' });
dotenv.config();

const SEEDS_ABI = JSON.parse(readFileSync('./lib/abi/TheSeeds.json', 'utf-8'));

async function checkRoundMode() {
  const rpcUrl = process.env.L2_RPC_URL;
  const contractAddress = process.env.L2_SEEDS_CONTRACT;

  if (!rpcUrl || !contractAddress) {
    throw new Error('Missing environment variables');
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const currentMode = await publicClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: SEEDS_ABI,
    functionName: 'getRoundMode',
    args: [],
  }) as number;

  const modeNames = ['ROUND_BASED', 'NON_ROUND_BASED'];
  console.log(`\nCurrent Round Mode: ${modeNames[currentMode]} (${currentMode})\n`);
}

checkRoundMode()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
