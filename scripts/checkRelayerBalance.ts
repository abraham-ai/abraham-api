/**
 * Check Relayer Account Balance
 * Verifies that the relayer account has sufficient ETH for gas
 */

import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function checkBalance() {
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  const rpcUrl = process.env.L2_RPC_URL;
  const network = process.env.NETWORK || "baseSepolia";

  if (!relayerKey) {
    console.error("❌ RELAYER_PRIVATE_KEY not set in .env.local");
    process.exit(1);
  }

  if (!rpcUrl) {
    console.error("❌ L2_RPC_URL not set in .env.local");
    process.exit(1);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔍 Checking Relayer Account Balance`);
  console.log(`   Network: ${network}`);
  console.log(`${"=".repeat(60)}\n`);

  // Create account from private key
  const account = privateKeyToAccount(
    (relayerKey.startsWith("0x") ? relayerKey : `0x${relayerKey}`) as `0x${string}`
  );

  console.log(`📍 Relayer Address: ${account.address}`);

  // Create public client
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  // Get balance
  const balance = await publicClient.getBalance({
    address: account.address,
  });

  const balanceInEth = formatEther(balance);

  console.log(`\n💰 Balance Information:`);
  console.log(`   Raw Balance: ${balance} wei`);
  console.log(`   ETH Balance: ${balanceInEth} ETH`);

  // Check if balance is sufficient
  const minBalance = BigInt(1e15); // 0.001 ETH
  const lowBalance = BigInt(1e16); // 0.01 ETH

  console.log(`\n📊 Status:`);

  if (balance === 0n) {
    console.log(`   ❌ CRITICAL: No balance!`);
    console.log(`   ⚠️  Please fund the account immediately`);
    console.log(`   💡 Get Base Sepolia ETH from: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet`);
  } else if (balance < minBalance) {
    console.log(`   ⚠️  WARNING: Very low balance (< 0.001 ETH)`);
    console.log(`   💡 Please add more funds soon`);
  } else if (balance < lowBalance) {
    console.log(`   ⚠️  Low balance (< 0.01 ETH)`);
    console.log(`   💡 Consider adding more funds`);
  } else {
    console.log(`   ✅ Balance is sufficient`);
  }

  console.log(`\n${"=".repeat(60)}\n`);
}

checkBalance().catch((error) => {
  console.error("Error checking balance:", error);
  process.exit(1);
});
