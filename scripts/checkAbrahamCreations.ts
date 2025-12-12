/**
 * Script to check Abraham Covenant status on Ethereum Sepolia
 * and fetch all created token details
 */

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

// Load ABIs
import { ABRAHAM_COVENANT_ABI } from '../lib/abi/abrahamCovenant.js';

async function checkAbrahamCreations() {
  console.log('\n🔍 Checking Abraham Covenant on Ethereum Sepolia...\n');

  const covenantAddress = process.env.ABRAHAM_COVENANT_ADDRESS;
  const rpcUrl = process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org';

  if (!covenantAddress) {
    console.log('❌ ABRAHAM_COVENANT_ADDRESS not set in .env');
    process.exit(1);
  }

  console.log(`📍 Network: Ethereum Sepolia`);
  console.log(`📄 Covenant Address: ${covenantAddress}`);
  console.log(`🔗 Explorer: https://sepolia.etherscan.io/address/${covenantAddress}\n`);

  // Create public client for Sepolia
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  try {
    // Get current day
    const currentDay = await publicClient.readContract({
      address: covenantAddress as `0x${string}`,
      abi: ABRAHAM_COVENANT_ABI,
      functionName: 'getCurrentDay',
    }) as bigint;

    console.log(`📅 Current Day: ${currentDay}`);

    // Check if committed today
    const hasCommittedToday = await publicClient.readContract({
      address: covenantAddress as `0x${string}`,
      abi: ABRAHAM_COVENANT_ABI,
      functionName: 'hasCommittedToday',
    }) as boolean;

    console.log(`✨ Committed Today: ${hasCommittedToday ? 'YES ❌' : 'NO ✅'}`);

    if (hasCommittedToday) {
      console.log('\n⏰ Already minted a creation today. Wait until tomorrow (UTC) to mint another.');

      // Calculate time until next day (UTC)
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(24, 0, 0, 0);
      const hoursUntil = Math.ceil((tomorrow.getTime() - now.getTime()) / (1000 * 60 * 60));

      console.log(`⏳ Next available: ${tomorrow.toISOString()} (~${hoursUntil} hours)`);
    } else {
      console.log('\n✅ Ready to mint a new creation!');
    }

    // Get total supply
    const totalSupply = await publicClient.readContract({
      address: covenantAddress as `0x${string}`,
      abi: ABRAHAM_COVENANT_ABI,
      functionName: 'totalSupply',
    }) as bigint;

    console.log(`\n📊 Total Supply: ${totalSupply} NFTs`);

    // Get max supply
    const maxSupply = await publicClient.readContract({
      address: covenantAddress as `0x${string}`,
      abi: ABRAHAM_COVENANT_ABI,
      functionName: 'maxSupply',
    }) as bigint;

    console.log(`📏 Max Supply: ${maxSupply} NFTs`);
    console.log(`📈 Remaining: ${Number(maxSupply) - Number(totalSupply)} NFTs\n`);

    // Fetch all daily works (creations)
    console.log('═'.repeat(60));
    console.log('🎨 ALL CREATIONS');
    console.log('═'.repeat(60));

    const creations = [];

    for (let day = 0; day <= Number(currentDay); day++) {
      try {
        const dailyWork = await publicClient.readContract({
          address: covenantAddress as `0x${string}`,
          abi: ABRAHAM_COVENANT_ABI,
          functionName: 'getDailyWork',
          args: [BigInt(day)],
        }) as { tokenId: bigint; timestamp: bigint; exists: boolean };

        if (dailyWork.exists) {
          // Get token URI
          let tokenURI = 'N/A';
          try {
            tokenURI = await publicClient.readContract({
              address: covenantAddress as `0x${string}`,
              abi: ABRAHAM_COVENANT_ABI,
              functionName: 'tokenURI',
              args: [dailyWork.tokenId],
            }) as string;
          } catch (e) {
            // Token might not have URI yet
          }

          // Get token owner
          let owner = 'N/A';
          try {
            owner = await publicClient.readContract({
              address: covenantAddress as `0x${string}`,
              abi: ABRAHAM_COVENANT_ABI,
              functionName: 'ownerOf',
              args: [dailyWork.tokenId],
            }) as string;
          } catch (e) {
            // Token might be burned or not minted
          }

          const isNullToken = Number(dailyWork.timestamp) === 0;
          const date = isNullToken ? 'MISSED DAY' : new Date(Number(dailyWork.timestamp) * 1000).toISOString();

          console.log(`\n📦 Day ${day}:`);
          console.log(`   Token ID: ${dailyWork.tokenId}`);
          console.log(`   Type: ${isNullToken ? '🚫 Null Token (missed day)' : '✅ Creation'}`);
          console.log(`   Date: ${date}`);
          console.log(`   Owner: ${owner}`);
          console.log(`   Metadata: ${tokenURI}`);
          console.log(`   View on Etherscan: https://sepolia.etherscan.io/token/${covenantAddress}?a=${dailyWork.tokenId}`);

          creations.push({
            day,
            tokenId: Number(dailyWork.tokenId),
            type: isNullToken ? 'Null' : 'Creation',
            timestamp: Number(dailyWork.timestamp),
            date,
            owner,
            metadata: tokenURI,
          });
        }
      } catch (error) {
        // Day doesn't have work committed
      }
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`📊 SUMMARY: ${creations.length} total works committed`);
    console.log('═'.repeat(60));

    const realCreations = creations.filter(c => c.type === 'Creation');
    const nullTokens = creations.filter(c => c.type === 'Null');

    console.log(`✅ Real Creations: ${realCreations.length}`);
    console.log(`🚫 Null Tokens (missed days): ${nullTokens.length}\n`);

    if (realCreations.length > 0) {
      console.log('🎨 Real Creations:');
      console.table(realCreations.map(c => ({
        Day: c.day,
        TokenID: c.tokenId,
        Date: c.date,
        Metadata: c.metadata.substring(0, 50) + '...',
      })));
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the script
checkAbrahamCreations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
