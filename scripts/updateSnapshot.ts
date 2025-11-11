/**
 * Unified Snapshot Update Script
 *
 * This script performs all steps to update the snapshot and merkle tree:
 * 1. Generate FirstWorks NFT ownership snapshot
 * 2. Generate Merkle tree from snapshot
 * 3. Update Merkle root on The Seeds contract (L2)
 *
 * Usage:
 *   # Update snapshot and merkle root
 *   npm run update-snapshot
 *
 *   # Update without updating contract (just generate snapshot + merkle)
 *   SKIP_CONTRACT_UPDATE=true npm run update-snapshot
 *
 *   # Specify network (default: baseSepolia)
 *   NETWORK=base npm run update-snapshot
 */

import { FirstWorksSnapshotGenerator } from "../lib/snapshots/firstWorksSnapshot.js";
import { generateMerkleTree, verifyProof } from "../lib/snapshots/merkleTreeGenerator.js";
import { writeFileSync } from "fs";
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });
dotenv.config();

// Contract ABI
const theSeedsAbi = parseAbi([
  "function currentOwnershipRoot() view returns (bytes32)",
  "function rootTimestamp() view returns (uint256)",
  "function updateOwnershipRoot(bytes32 _newRoot) external",
]);

// Network configuration
const networks = {
  base: {
    chain: base,
    rpcUrl: process.env.BASE_MAINNET_RPC || process.env.BASE_RPC_URL || "https://mainnet.base.org",
  },
  baseSepolia: {
    chain: baseSepolia,
    rpcUrl: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
  },
};

interface UpdateResult {
  success: boolean;
  snapshotPath?: string;
  merklePath?: string;
  merkleRoot?: string;
  txHash?: string;
  blockNumber?: bigint;
  error?: string;
  steps: {
    snapshot: boolean;
    merkle: boolean;
    contract: boolean;
  };
}

/**
 * Step 1: Generate NFT Snapshot
 */
async function generateSnapshot(): Promise<string> {
  console.log("\n" + "=".repeat(60));
  console.log("STEP 1: Generating FirstWorks NFT Snapshot");
  console.log("=".repeat(60) + "\n");

  const generator = new FirstWorksSnapshotGenerator();
  const snapshot = await generator.generateSnapshot();
  const filepath = await generator.saveSnapshot(snapshot);

  console.log("\n✓ Snapshot generated successfully");
  return filepath;
}

/**
 * Step 2: Generate Merkle Tree
 */
async function generateMerkle(snapshotPath: string): Promise<{ root: string; path: string }> {
  console.log("\n" + "=".repeat(60));
  console.log("STEP 2: Generating Merkle Tree");
  console.log("=".repeat(60) + "\n");

  const outputPath = "./lib/snapshots/firstWorks_merkle.json";

  console.log(`Reading snapshot from: ${snapshotPath}`);

  const merkleData = generateMerkleTree(snapshotPath);

  // Save to file
  writeFileSync(outputPath, JSON.stringify(merkleData, null, 2));
  console.log(`Merkle tree saved to: ${outputPath}`);

  // Print stats
  console.log("\n=== Merkle Tree Statistics ===");
  console.log(`Total Leaves: ${Object.keys(merkleData.leaves).length}`);
  console.log(`Total Proofs: ${Object.keys(merkleData.proofs).length}`);
  console.log(`Merkle Root: ${merkleData.root}`);

  // Verify a random proof
  const randomHolder = Object.keys(merkleData.proofs)[0];
  const randomProof = merkleData.proofs[randomHolder];
  const randomLeaf = merkleData.leaves[randomHolder];
  const isValid = verifyProof(randomProof, merkleData.root, randomLeaf);

  console.log("\n=== Verification Test ===");
  console.log(`Testing holder: ${randomHolder}`);
  console.log(`Proof valid: ${isValid ? "✓" : "✗"}`);

  if (!isValid) {
    throw new Error("Proof verification failed!");
  }

  console.log("\n✓ Merkle tree generated successfully");
  return { root: merkleData.root, path: outputPath };
}

/**
 * Step 3: Update Contract with New Merkle Root
 */
async function updateContract(merkleRoot: string): Promise<{ txHash: string; blockNumber: bigint }> {
  console.log("\n" + "=".repeat(60));
  console.log("STEP 3: Updating Contract Merkle Root");
  console.log("=".repeat(60) + "\n");

  // Get network from environment
  const networkName = (process.env.NETWORK || "baseSepolia") as keyof typeof networks;
  const networkConfig = networks[networkName];

  if (!networkConfig) {
    throw new Error(
      `Invalid network: ${networkName}. Valid options: ${Object.keys(networks).join(", ")}`
    );
  }

  console.log(`Network: ${networkName}`);
  console.log(`Chain ID: ${networkConfig.chain.id}`);

  // Get contract address from environment
  const contractAddress = process.env.CONTRACT_ADDRESS as Address;
  if (!contractAddress) {
    throw new Error("CONTRACT_ADDRESS not set in environment");
  }

  // Get private key from environment
  const privateKey = (process.env.RELAYER_PRIVATE_KEY || process.env.PRIVATE_KEY) as Hex;
  if (!privateKey) {
    throw new Error("RELAYER_PRIVATE_KEY or PRIVATE_KEY not set in environment");
  }

  // Create account from private key
  const account = privateKeyToAccount(privateKey);
  console.log(`Signer: ${account.address}`);
  console.log(`Contract Address: ${contractAddress}`);
  console.log(`Merkle Root: ${merkleRoot}`);

  // Create clients
  const publicClient = createPublicClient({
    chain: networkConfig.chain,
    transport: http(networkConfig.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: networkConfig.chain,
    transport: http(networkConfig.rpcUrl),
  });

  // Check current root
  const currentRoot = await publicClient.readContract({
    address: contractAddress,
    abi: theSeedsAbi,
    functionName: "currentOwnershipRoot",
  });

  console.log(`\nCurrent Root: ${currentRoot}`);

  if (currentRoot === merkleRoot) {
    console.log("\n⚠ Merkle root is already up to date!");
    console.log("Skipping contract update...");
    return { txHash: "0x0", blockNumber: BigInt(0) };
  }

  // Update root
  console.log("\nUpdating Merkle root on contract...");
  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: theSeedsAbi,
    functionName: "updateOwnershipRoot",
    args: [merkleRoot as Hex],
  });

  console.log(`Transaction hash: ${txHash}`);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  console.log(`✓ Root updated in block ${receipt.blockNumber}`);

  // Verify update
  const newRoot = await publicClient.readContract({
    address: contractAddress,
    abi: theSeedsAbi,
    functionName: "currentOwnershipRoot",
  });

  const rootTimestamp = await publicClient.readContract({
    address: contractAddress,
    abi: theSeedsAbi,
    functionName: "rootTimestamp",
  });

  console.log("\n=== Contract Update Complete ===");
  console.log(`New Root: ${newRoot}`);
  console.log(`Timestamp: ${new Date(Number(rootTimestamp) * 1000).toISOString()}`);
  console.log(`Block Number: ${receipt.blockNumber}`);

  console.log("\n✓ Contract updated successfully");
  return { txHash, blockNumber: receipt.blockNumber };
}

/**
 * Main execution
 */
export async function updateSnapshotAndMerkle(skipContractUpdate = false): Promise<UpdateResult> {
  const result: UpdateResult = {
    success: false,
    steps: {
      snapshot: false,
      merkle: false,
      contract: false,
    },
  };

  try {
    console.log("\n" + "=".repeat(60));
    console.log("UNIFIED SNAPSHOT & MERKLE UPDATE");
    console.log("=".repeat(60));
    console.log(`\nTimestamp: ${new Date().toISOString()}`);
    console.log(`Skip Contract Update: ${skipContractUpdate ? "Yes" : "No"}`);

    // Step 1: Generate snapshot
    const snapshotPath = await generateSnapshot();
    result.snapshotPath = snapshotPath;
    result.steps.snapshot = true;

    // Step 2: Generate merkle tree
    const { root: merkleRoot, path: merklePath } = await generateMerkle("./lib/snapshots/latest.json");
    result.merklePath = merklePath;
    result.merkleRoot = merkleRoot;
    result.steps.merkle = true;

    // Step 3: Update contract (unless skipped)
    if (!skipContractUpdate) {
      const { txHash, blockNumber } = await updateContract(merkleRoot);
      result.txHash = txHash;
      result.blockNumber = blockNumber;
      result.steps.contract = txHash !== "0x0";
    } else {
      console.log("\n" + "=".repeat(60));
      console.log("STEP 3: SKIPPED (Contract update disabled)");
      console.log("=".repeat(60));
      result.steps.contract = false;
    }

    // Final summary
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`✓ Snapshot Generated: ${result.snapshotPath}`);
    console.log(`✓ Merkle Tree Generated: ${result.merklePath}`);
    console.log(`✓ Merkle Root: ${result.merkleRoot}`);

    if (result.txHash && result.txHash !== "0x0") {
      console.log(`✓ Contract Updated: ${result.txHash}`);
      console.log(`✓ Block Number: ${result.blockNumber}`);
    } else if (skipContractUpdate) {
      console.log(`⚠ Contract Update Skipped`);
    } else {
      console.log(`⚠ Contract Already Up to Date`);
    }

    console.log("\n✓ ALL STEPS COMPLETED SUCCESSFULLY!");
    console.log("=".repeat(60) + "\n");

    result.success = true;
    return result;
  } catch (error) {
    console.error("\n❌ Update process failed:", error);
    result.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

// Allow running as a script
if (import.meta.url === `file://${process.argv[1]}`) {
  const skipContractUpdate = process.env.SKIP_CONTRACT_UPDATE === "true";

  updateSnapshotAndMerkle(skipContractUpdate)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
