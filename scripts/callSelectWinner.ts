/**
 * Direct Select Winner Call
 *
 * Calls selectDailyWinner() directly on the contract without diagnostics.
 * Use this after changing to SKIP_ROUND strategy.
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("📞 CALLING selectDailyWinner() DIRECTLY");
  console.log("=".repeat(70) + "\n");

  const contractAddress = process.env.L2_SEEDS_CONTRACT as Address;
  const rpcUrl = process.env.L2_RPC_URL;
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;

  if (!relayerKey) {
    throw new Error("RELAYER_PRIVATE_KEY not set");
  }

  // Load ABI
  const abiPath = join(__dirname, "../lib/abi/TheSeeds.json");
  const SEEDS_ABI = JSON.parse(readFileSync(abiPath, "utf-8"));

  // Create clients
  const account = privateKeyToAccount(
    (relayerKey.startsWith("0x") ? relayerKey : `0x${relayerKey}`) as `0x${string}`
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

  console.log(`Contract: ${contractAddress}`);
  console.log(`Relayer: ${account.address}`);
  console.log(`Network: Base Sepolia\n`);

  // Check current state
  console.log("📊 Current State:");
  const currentRound = await publicClient.readContract({
    address: contractAddress,
    abi: SEEDS_ABI,
    functionName: "currentRound",
  });

  const deadlockStrategy = await publicClient.readContract({
    address: contractAddress,
    abi: SEEDS_ABI,
    functionName: "getDeadlockStrategy",
  });

  const strategyNames = ["REVERT", "SKIP_ROUND"];
  console.log(`  Round: ${currentRound}`);
  console.log(`  Deadlock Strategy: ${strategyNames[Number(deadlockStrategy)]}\n`);

  if (Number(deadlockStrategy) !== 1) {
    console.error("❌ Deadlock strategy is not SKIP_ROUND!");
    console.error("   Run: npx hardhat run scripts/skipRound.ts --network baseSepolia");
    console.error("   Or change strategy first");
    process.exit(1);
  }

  // Call selectDailyWinner
  console.log("📞 Calling selectDailyWinner()...");
  console.log("   This will skip the round and start a new voting period\n");

  try {
    // Simulate first to check if it will work
    await publicClient.simulateContract({
      address: contractAddress,
      abi: SEEDS_ABI,
      functionName: "selectDailyWinner",
      account: account.address,
    });

    // Send the transaction
    const hash = await walletClient.writeContract({
      address: contractAddress,
      abi: SEEDS_ABI,
      functionName: "selectDailyWinner",
    });
    console.log(`  ⏳ Transaction sent: ${hash}`);
    console.log(`     Block Explorer: https://sepolia.basescan.org/tx/${hash}\n`);

    console.log("  ⏳ Waiting for confirmation...");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log(`  ✅ Transaction confirmed!`);
    console.log(`     Block: ${receipt.blockNumber}`);
    console.log(`     Gas Used: ${receipt.gasUsed}\n`);

    // Check new state
    console.log("📊 New State:");
    const newRound = await publicClient.readContract({
      address: contractAddress,
      abi: SEEDS_ABI,
      functionName: "currentRound",
    });

    const timeRemaining = await publicClient.readContract({
      address: contractAddress,
      abi: SEEDS_ABI,
      functionName: "getTimeUntilPeriodEnd",
    });

    console.log(`  Current Round: ${newRound}`);
    console.log(`  Time Until Period End: ${timeRemaining}s (~${Number(timeRemaining) / 3600} hours)`);
    console.log(`  Voting Period Active: ${Number(timeRemaining) > 0 ? 'YES ✅' : 'NO ❌'}\n`);

    // Summary
    console.log("=" + "=".repeat(69));
    console.log("✅ ROUND SKIPPED SUCCESSFULLY!");
    console.log("=" + "=".repeat(69) + "\n");

    console.log("The deadlock has been broken!");
    console.log(`Round ${currentRound} was skipped, now on round ${newRound}`);
    console.log(`New voting period: ~${Math.floor(Number(timeRemaining) / 3600)} hours remaining\n`);

    console.log("Next steps:");
    console.log(`  1. Cast blessings on seeds during this voting period`);
    console.log(`  2. Wait for voting period to end`);
    console.log(`  3. Select winner normally\n`);

  } catch (error: any) {
    console.error("❌ Transaction failed:", error.message);
    if (error.cause) {
      console.error("   Cause:", error.cause);
    }
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  });
