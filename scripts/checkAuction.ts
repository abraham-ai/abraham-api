/**
 * Script to check auction details for a token
 */

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

// Load ABIs
import { ABRAHAM_AUCTION_ABI } from '../lib/abi/abrahamAuction.js';

async function checkAuction() {
  const tokenId = process.argv[2] ? parseInt(process.argv[2]) : 0;

  console.log(`\n🔍 Checking auction for Token ID ${tokenId}...\n`);

  const auctionAddress = process.env.ABRAHAM_AUCTION_ADDRESS;
  const rpcUrl = process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org';

  if (!auctionAddress) {
    console.log('❌ ABRAHAM_AUCTION_ADDRESS not set in .env');
    process.exit(1);
  }

  console.log(`📍 Network: Ethereum Sepolia`);
  console.log(`📄 Auction Address: ${auctionAddress}`);
  console.log(`🔗 Explorer: https://sepolia.etherscan.io/address/${auctionAddress}\n`);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  try {
    // Get auction ID for token
    const auctionId = await publicClient.readContract({
      address: auctionAddress as `0x${string}`,
      abi: ABRAHAM_AUCTION_ABI,
      functionName: 'tokenToAuction',
      args: [BigInt(tokenId)],
    }) as bigint;

    if (auctionId === 0n) {
      console.log(`❌ No auction found for Token ID ${tokenId}`);
      console.log('\nTo create an auction, use:');
      console.log(`curl -X POST -H "X-Admin-Key: father-abraham" \\`);
      console.log(`  "http://localhost:3000/api/admin/create-auction?tokenId=${tokenId}"`);
      process.exit(0);
    }

    console.log(`✅ Auction ID: ${auctionId}\n`);

    // Get auction details
    const auction = await publicClient.readContract({
      address: auctionAddress as `0x${string}`,
      abi: ABRAHAM_AUCTION_ABI,
      functionName: 'getAuction',
      args: [auctionId],
    }) as any;

    console.log('═'.repeat(60));
    console.log(`🎯 AUCTION #${auctionId} DETAILS`);
    console.log('═'.repeat(60));

    const now = Math.floor(Date.now() / 1000);
    const startTime = Number(auction.startTime);
    const endTime = Number(auction.endTime);
    const hasStarted = now >= startTime;
    const hasEnded = now >= endTime;

    let status = '';
    if (!hasStarted) {
      status = '🟡 PENDING';
    } else if (hasEnded) {
      status = '🔴 ENDED';
    } else {
      status = '🟢 ACTIVE';
    }

    console.log(`\n📊 Status: ${status}`);
    console.log(`🪙 Token ID: ${auction.tokenId}`);
    console.log(`💰 Current Bid: ${Number(auction.highestBid) / 1e18} ETH`);
    console.log(`👤 Current Bidder: ${auction.highestBidder}`);
    console.log(`💸 Min Bid: ${Number(auction.minBid) / 1e18} ETH`);
    console.log(`📅 Start Time: ${new Date(startTime * 1000).toISOString()}`);
    console.log(`⏰ End Time: ${new Date(endTime * 1000).toISOString()}`);
    console.log(`🔢 Extension Count: ${auction.extensionCount}`);
    console.log(`✅ Settled: ${auction.settled ? 'YES' : 'NO'}`);

    if (!hasEnded && hasStarted) {
      const timeLeft = endTime - now;
      const hours = Math.floor(timeLeft / 3600);
      const minutes = Math.floor((timeLeft % 3600) / 60);
      console.log(`\n⏳ Time Remaining: ${hours}h ${minutes}m`);
    }

    console.log(`\n🔗 View on Etherscan: https://sepolia.etherscan.io/address/${auctionAddress}#readContract`);

    // Note: Bid history function not available on this contract version
    console.log('\n📜 BID HISTORY');
    console.log('   (Bid history function not available on this contract version)');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the script
checkAuction()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
