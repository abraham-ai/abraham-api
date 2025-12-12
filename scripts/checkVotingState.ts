import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const SEEDS_ABI = JSON.parse(readFileSync('./lib/abi/TheSeeds.json', 'utf-8'));

async function checkVotingState() {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.L2_RPC_URL!),
  });

  const contractAddress = process.env.L2_SEEDS_CONTRACT as `0x${string}`;

  console.log('Verifying contract state...\n');

  const votingPeriod = await publicClient.readContract({
    address: contractAddress,
    abi: SEEDS_ABI,
    functionName: 'votingPeriod',
    args: [],
  }) as bigint;

  const periodStart = await publicClient.readContract({
    address: contractAddress,
    abi: SEEDS_ABI,
    functionName: 'currentVotingPeriodStart',
    args: [],
  }) as bigint;

  const timeRemaining = await publicClient.readContract({
    address: contractAddress,
    abi: SEEDS_ABI,
    functionName: 'getTimeUntilPeriodEnd',
    args: [],
  }) as bigint;

  const currentTime = Math.floor(Date.now() / 1000);
  const periodEnd = Number(periodStart) + Number(votingPeriod);

  console.log('Voting Period:', Number(votingPeriod), 'seconds =', Number(votingPeriod) / 86400, 'days');
  console.log('Period Start:', new Date(Number(periodStart) * 1000).toISOString());
  console.log('Period End (calculated):', new Date(periodEnd * 1000).toISOString());
  console.log('Current Time:', new Date(currentTime * 1000).toISOString());
  console.log('Time Remaining:', Number(timeRemaining), 'seconds =', (Number(timeRemaining) / 3600).toFixed(2), 'hours');
  console.log('\nPeriod expired:', currentTime >= periodEnd);
  console.log('Can bless:', Number(timeRemaining) > 0);
}

checkVotingState()
  .then(() => process.exit(0))
  .catch(console.error);
