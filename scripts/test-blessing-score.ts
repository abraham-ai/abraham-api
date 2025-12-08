/**
 * Test Blessing Score Fix
 *
 * This script:
 * 1. Grants RELAYER_ROLE to relayer
 * 2. Updates the Merkle root (if needed)
 * 3. Blesses the test seed
 * 4. Checks the blessing score to verify the fix works
 *
 * Run with: npx tsx scripts/test-blessing-score.ts
 */

import { createPublicClient, createWalletClient, http, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// Load deployment result
const deploymentResult = JSON.parse(readFileSync("deployment-result.json", "utf-8"));
const contractAddress = deploymentResult.contractAddress as Address;
const merkleRoot = deploymentResult.merkleRoot as Hex;

console.log("═══════════════════════════════════════════════════════");
console.log("  Testing Blessing Score Fix");
console.log("═══════════════════════════════════════════════════════\n");
console.log(`Contract: ${contractAddress}`);
console.log(`Network: Base Sepolia\n`);

// Load ABI
const SEEDS_ABI = JSON.parse(readFileSync("./lib/abi/TheSeeds.json", "utf-8"));

// Load merkle tree
const merkleData = JSON.parse(readFileSync("./lib/snapshots/firstWorks_merkle.json", "utf-8"));

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const privateKey = (process.env.PRIVATE_KEY!.startsWith("0x")
    ? process.env.PRIVATE_KEY
    : `0x${process.env.PRIVATE_KEY}`) as Hex;

  const account = privateKeyToAccount(privateKey);

  const client = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
  });

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
  });

  console.log(`Relayer: ${account.address}\n`);

  // ============================================================
  // STEP 1: Check and grant RELAYER_ROLE
  // ============================================================
  console.log("📝 Step 1: Checking RELAYER_ROLE...");

  const RELAYER_ROLE = await publicClient.readContract({
    address: contractAddress,
    abi: SEEDS_ABI,
    functionName: "RELAYER_ROLE",
  }) as Hex;

  console.log(`   RELAYER_ROLE: ${RELAYER_ROLE}`);

  const hasRelayerRole = await publicClient.readContract({
    address: contractAddress,
    abi: SEEDS_ABI,
    functionName: "hasRole",
    args: [RELAYER_ROLE, account.address],
  });

  if (!hasRelayerRole) {
    console.log("   Granting RELAYER_ROLE...");
    const hash = await client.writeContract({
      address: contractAddress,
      abi: SEEDS_ABI,
      functionName: "addRelayer",
      args: [account.address],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`   ✅ RELAYER_ROLE granted (tx: ${hash})`);
    await sleep(2000);
  } else {
    console.log("   ✅ Already has RELAYER_ROLE");
  }

  // ============================================================
  // STEP 2: Update Merkle root if needed
  // ============================================================
  console.log("\n📝 Step 2: Checking Merkle root...");

  const currentRoot = await publicClient.readContract({
    address: contractAddress,
    abi: SEEDS_ABI,
    functionName: "currentOwnershipRoot",
  }) as Hex;

  console.log(`   Current root: ${currentRoot}`);
  console.log(`   Expected root: ${merkleRoot}`);

  if (currentRoot === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    console.log("   Updating Merkle root...");
    const hash = await client.writeContract({
      address: contractAddress,
      abi: SEEDS_ABI,
      functionName: "updateOwnershipRoot",
      args: [merkleRoot as Hex],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`   ✅ Merkle root updated (tx: ${hash})`);
    await sleep(2000);
  } else {
    console.log("   ✅ Merkle root already set");
  }

  // ============================================================
  // STEP 3: Get a holder with NFTs to test blessing
  // ============================================================
  console.log("\n📝 Step 3: Finding a holder to test with...");

  // Load snapshot to get token IDs
  const snapshot = JSON.parse(readFileSync("./lib/snapshots/latest.json", "utf-8"));
  const holders = snapshot.holders;

  if (holders.length === 0) {
    throw new Error("No holders found in snapshot");
  }

  const testHolderData = holders[0];
  const testHolder = testHolderData.address as Address;
  const tokenIds = testHolderData.tokenIds; // Use ALL tokens (proof is for all)
  const proof = merkleData.proofs[testHolder] as Hex[];

  console.log(`   Test holder: ${testHolder}`);
  console.log(`   Token IDs: ${tokenIds.slice(0, 3).join(", ")}${tokenIds.length > 3 ? "..." : ""}`);
  console.log(`   Total NFTs: ${testHolderData.balance}`);

  // ============================================================
  // STEP 4: Bless seed 0
  // ============================================================
  console.log("\n📝 Step 4: Blessing seed 0...");

  const seedId = 0n;

  try {
    const hash = await client.writeContract({
      address: contractAddress,
      abi: SEEDS_ABI,
      functionName: "blessSeedFor",
      args: [seedId, testHolder, tokenIds.map((id: number) => BigInt(id)), proof],
    });

    console.log(`   Transaction: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`   ✅ Blessing successful!`);
    await sleep(2000);
  } catch (error: any) {
    console.error(`   ❌ Blessing failed: ${error.message}`);
    throw error;
  }

  // ============================================================
  // STEP 5: Check blessing score
  // ============================================================
  console.log("\n📝 Step 5: Checking blessing score...");

  const score = await publicClient.readContract({
    address: contractAddress,
    abi: SEEDS_ABI,
    functionName: "seedBlessingScore",
    args: [seedId],
  }) as bigint;

  const seed = await publicClient.readContract({
    address: contractAddress,
    abi: SEEDS_ABI,
    functionName: "getSeed",
    args: [seedId],
  }) as any;

  // Seed struct: [id, creator, ipfsHash, blessings, createdAt, isWinner, winnerInRound, submittedInRound]
  const blessings = Array.isArray(seed) ? seed[3] : seed.blessings;

  console.log(`   Seed ID: ${seedId}`);
  console.log(`   Raw Blessings: ${blessings}`);
  console.log(`   Blessing Score: ${score}`);

  // ============================================================
  // STEP 6: Verify fix worked
  // ============================================================
  console.log("\n═══════════════════════════════════════════════════════");

  // Verify the relationship: blessings > 0 ⟺ score > 0
  const expectedScoreIsZero = Number(blessings) === 0;
  const actualScoreIsZero = score === 0n;

  if (expectedScoreIsZero === actualScoreIsZero) {
    if (score > 0n) {
      console.log("✅ SUCCESS! Blessing score is > 0 (as expected with blessings)");
      console.log(`   Raw Blessings: ${blessings}`);
      console.log(`   Score: ${score}`);
      console.log(`   Fix is working correctly!`);
    } else {
      console.log("✅ CORRECT! Blessing score is 0 (as expected with 0 blessings)");
      console.log(`   Raw Blessings: ${blessings}`);
      console.log(`   Score: ${score}`);
    }
  } else {
    console.log("❌ FAILED! Score doesn't match blessing count");
    console.log(`   Raw Blessings: ${blessings}`);
    console.log(`   Score: ${score}`);
    console.log(`   Expected: ${expectedScoreIsZero ? "0" : "> 0"}`);
  }

  console.log("═══════════════════════════════════════════════════════\n");

  // ============================================================
  // STEP 7: Check current leader
  // ============================================================
  console.log("📝 Step 6: Checking current leader...");

  const leader = await publicClient.readContract({
    address: contractAddress,
    abi: SEEDS_ABI,
    functionName: "getCurrentLeader",
  }) as [bigint, bigint];

  console.log(`   Leading Seed ID: ${leader[0]}`);
  console.log(`   Leading Score: ${leader[1]}`);

  if (leader[1] > 0n) {
    console.log(`   ✅ Leader has score > 0`);
  }

  console.log("\n🎉 Test complete!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test failed:", error.message || error);
    process.exit(1);
  });
