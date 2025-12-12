/**
 * Check Abraham token metadata
 */

import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import dotenv from 'dotenv';
import { ABRAHAM_COVENANT_ABI } from '../lib/abi/abrahamCovenant.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

async function checkToken() {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL!),
  });

  const covenantAddress = process.env.ABRAHAM_COVENANT_ADDRESS as `0x${string}`;

  console.log('\n📊 Checking Abraham Covenant Contract State:\n');
  console.log('Contract Address:', covenantAddress);
  console.log('');

  // Get total supply
  const totalSupply = await publicClient.readContract({
    address: covenantAddress,
    abi: ABRAHAM_COVENANT_ABI,
    functionName: 'totalSupply',
    args: [],
  }) as bigint;

  console.log('Total Supply:', totalSupply.toString());
  console.log('');

  // Check each token's metadata
  for (let tokenId = 0; tokenId < Number(totalSupply); tokenId++) {
    console.log(`Token ID ${tokenId}:`);

    try {
      const tokenURI = await publicClient.readContract({
        address: covenantAddress,
        abi: ABRAHAM_COVENANT_ABI,
        functionName: 'tokenURI',
        args: [BigInt(tokenId)],
      }) as string;

      console.log(`  Token URI: ${tokenURI}`);
      console.log(`  Length: ${tokenURI.length} characters`);
      console.log(`  Empty: ${tokenURI.trim() === '' ? '❌ YES' : '✅ NO'}`);

      if (tokenURI.startsWith('ipfs://')) {
        console.log(`  Valid IPFS: ✅`);
      } else {
        console.log(`  Valid IPFS: ❌ (doesn't start with ipfs://)`);
      }
    } catch (error: any) {
      console.log(`  Error reading tokenURI: ${error.message}`);
    }

    console.log('');
  }

  // Check if committed today
  const hasCommitted = await publicClient.readContract({
    address: covenantAddress,
    abi: ABRAHAM_COVENANT_ABI,
    functionName: 'hasCommittedToday',
    args: [],
  }) as boolean;

  console.log('Has Committed Today:', hasCommitted ? '✅ YES' : '❌ NO');
  console.log('');

  if (hasCommitted) {
    console.log('⚠️  Daily commit limit reached');
    console.log('   Next creation available after UTC midnight');
  }
}

checkToken()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
