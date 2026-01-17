import hre from "hardhat";
import { createWalletClient, http, publicActions, encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import { config as dotenvConfig } from "dotenv";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

// Load .env.local
dotenvConfig({ path: ".env.local" });

/**
 * Deploy AbrahamSeeds contract and MerkleGating module to Base L2
 *
 * This deployment script:
 * 1. Deploys MerkleGating module
 * 2. Deploys AbrahamSeeds contract with gating module
 * 3. Sets up roles (OPERATOR_ROLE, CREATOR_ROLE)
 * 4. Updates merkle root from existing merkle tree
 * 5. Creates a test seed
 * 6. Saves ABIs and addresses
 */
async function main() {
  console.log("=== AbrahamSeeds Deployment ===\n");

  // Get network name from CLI arguments
  const networkArg = process.argv.find((arg) => arg.startsWith("--network"));
  const networkName = networkArg
    ? networkArg.split("=")[1] || process.argv[process.argv.indexOf(networkArg) + 1]
    : "baseSepolia";
  console.log("Network:", networkName);

  // Get network config
  let chain;
  let rpcUrl;

  switch (networkName) {
    case "baseSepolia":
      chain = baseSepolia;
      rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
      break;
    case "baseMainnet":
      chain = base;
      rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
      break;
    default:
      throw new Error(`Unsupported network: ${networkName}. Use baseSepolia or baseMainnet`);
  }

  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not found in environment variables");
  }

  // Create wallet client
  const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY.replace("0x", "")}`);
  const client = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  }).extend(publicActions);

  console.log("Deployer:", account.address);
  console.log("RPC URL:", rpcUrl);
  console.log("");

  // Get compiled contracts
  const MerkleGating = await hre.artifacts.readArtifact("MerkleGating");
  const AbrahamSeeds = await hre.artifacts.readArtifact("AbrahamSeeds");

  // ============================================================
  // 1. Deploy MerkleGating
  // ============================================================
  console.log("1. Deploying MerkleGating module...");

  const gatingHash = await client.deployContract({
    abi: MerkleGating.abi as any,
    bytecode: MerkleGating.bytecode as `0x${string}`,
    args: [account.address], // admin (owner)
  });

  console.log("   Transaction hash:", gatingHash);
  console.log("   Waiting for confirmation...");

  const gatingReceipt = await client.waitForTransactionReceipt({ hash: gatingHash });
  const gatingAddress = gatingReceipt.contractAddress;

  if (!gatingAddress) {
    throw new Error("MerkleGating deployment failed - no address returned");
  }

  console.log("   MerkleGating deployed at:", gatingAddress);
  console.log("   Block number:", gatingReceipt.blockNumber);
  console.log("");

  // ============================================================
  // 2. Deploy AbrahamSeeds
  // ============================================================
  console.log("2. Deploying AbrahamSeeds contract...");

  const baseURI = "ipfs://"; // Base URI for token metadata

  const seedsHash = await client.deployContract({
    abi: AbrahamSeeds.abi as any,
    bytecode: AbrahamSeeds.bytecode as `0x${string}`,
    args: [
      account.address, // admin
      account.address, // treasury
      gatingAddress,   // gating module
      baseURI,         // base URI
    ],
  });

  console.log("   Transaction hash:", seedsHash);
  console.log("   Waiting for confirmation...");

  const seedsReceipt = await client.waitForTransactionReceipt({ hash: seedsHash });
  const seedsAddress = seedsReceipt.contractAddress;

  if (!seedsAddress) {
    throw new Error("AbrahamSeeds deployment failed - no address returned");
  }

  console.log("   AbrahamSeeds deployed at:", seedsAddress);
  console.log("   Block number:", seedsReceipt.blockNumber);
  console.log("");

  // ============================================================
  // 3. Grant roles to deployer (for relayer operations)
  // ============================================================
  console.log("3. Setting up roles...");

  // Grant CREATOR_ROLE to deployer (for seed submission)
  const creatorRoleHash = await client.writeContract({
    address: seedsAddress,
    abi: AbrahamSeeds.abi as any,
    functionName: "addCreator",
    args: [account.address],
  });
  await client.waitForTransactionReceipt({ hash: creatorRoleHash });
  console.log("   CREATOR_ROLE granted to:", account.address);

  // Grant OPERATOR_ROLE to deployer (for relayer operations)
  const operatorRoleHash = await client.writeContract({
    address: seedsAddress,
    abi: AbrahamSeeds.abi as any,
    functionName: "addOperator",
    args: [account.address],
  });
  await client.waitForTransactionReceipt({ hash: operatorRoleHash });
  console.log("   OPERATOR_ROLE granted to:", account.address);
  console.log("");

  // ============================================================
  // 4. Update Merkle Root (if merkle tree exists)
  // ============================================================
  console.log("4. Checking for merkle tree...");

  const merklePath = join(process.cwd(), "lib/snapshots/firstWorks_merkle.json");
  if (existsSync(merklePath)) {
    try {
      const merkleData = JSON.parse(readFileSync(merklePath, "utf-8"));
      const root = merkleData.root as `0x${string}`;

      console.log("   Found merkle tree with root:", root);
      console.log("   Updating merkle root on MerkleGating...");

      const updateRootHash = await client.writeContract({
        address: gatingAddress,
        abi: MerkleGating.abi as any,
        functionName: "updateRoot",
        args: [root],
      });
      await client.waitForTransactionReceipt({ hash: updateRootHash });
      console.log("   Merkle root updated successfully");
    } catch (error: any) {
      console.log("   Warning: Could not update merkle root:", error.message);
    }
  } else {
    console.log("   No merkle tree found at", merklePath);
    console.log("   Run 'npm run merkle:generate' to create one");
  }
  console.log("");

  // ============================================================
  // 5. Create a test seed
  // ============================================================
  console.log("5. Creating test seed...");

  const testIpfsHash = "ipfs://QmTestAbrahamSeedDeployment" + Date.now();

  const submitSeedHash = await client.writeContract({
    address: seedsAddress,
    abi: AbrahamSeeds.abi as any,
    functionName: "submitSeed",
    args: [testIpfsHash],
  });
  await client.waitForTransactionReceipt({ hash: submitSeedHash });

  // Get seed count to verify
  const seedCount = await client.readContract({
    address: seedsAddress,
    abi: AbrahamSeeds.abi as any,
    functionName: "getSeedCount",
    args: [],
  }) as bigint;

  console.log("   Test seed created with IPFS hash:", testIpfsHash);
  console.log("   Total seeds:", seedCount.toString());
  console.log("");

  // ============================================================
  // 6. Save ABIs and addresses
  // ============================================================
  console.log("6. Saving ABIs and deployment info...");

  const abiDir = join(process.cwd(), "lib", "abi");
  if (!existsSync(abiDir)) {
    mkdirSync(abiDir, { recursive: true });
  }

  // Save AbrahamSeeds ABI as JSON (for contractService)
  const abrahamSeedsAbiPath = join(abiDir, "AbrahamSeeds.json");
  writeFileSync(abrahamSeedsAbiPath, JSON.stringify(AbrahamSeeds.abi, null, 2));
  console.log("   Saved AbrahamSeeds ABI to:", abrahamSeedsAbiPath);

  // Save MerkleGating ABI
  const merkleGatingAbiPath = join(abiDir, "MerkleGating.json");
  writeFileSync(merkleGatingAbiPath, JSON.stringify(MerkleGating.abi, null, 2));
  console.log("   Saved MerkleGating ABI to:", merkleGatingAbiPath);

  // Save deployment info
  const deploymentInfo = {
    network: networkName,
    chainId: chain.id,
    timestamp: new Date().toISOString(),
    deployer: account.address,
    contracts: {
      merkleGating: {
        address: gatingAddress,
        blockNumber: gatingReceipt.blockNumber.toString(),
        txHash: gatingHash,
      },
      abrahamSeeds: {
        address: seedsAddress,
        blockNumber: seedsReceipt.blockNumber.toString(),
        txHash: seedsHash,
      },
    },
  };

  const deploymentInfoPath = join(abiDir, "abraham-seeds-deployment.json");
  writeFileSync(deploymentInfoPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("   Saved deployment info to:", deploymentInfoPath);
  console.log("");

  // ============================================================
  // Summary
  // ============================================================
  console.log("=== Deployment Successful ===\n");
  console.log("Contract Addresses:");
  console.log(`  MerkleGating:  ${gatingAddress}`);
  console.log(`  AbrahamSeeds:  ${seedsAddress}`);
  console.log("");

  console.log("Environment Variables (add to .env.local):");
  console.log(`  L2_SEEDS_CONTRACT=${seedsAddress}`);
  console.log(`  L2_GATING_CONTRACT=${gatingAddress}`);
  console.log(`  L2_SEEDS_DEPLOYMENT_BLOCK=${seedsReceipt.blockNumber}`);
  console.log(`  NETWORK=${networkName === "baseMainnet" ? "base" : "baseSepolia"}`);
  console.log("");

  const explorerUrl = networkName === "baseMainnet"
    ? `https://basescan.org/address/`
    : `https://sepolia.basescan.org/address/`;

  console.log("Block Explorer Links:");
  console.log(`  MerkleGating:  ${explorerUrl}${gatingAddress}`);
  console.log(`  AbrahamSeeds:  ${explorerUrl}${seedsAddress}`);
  console.log("");

  console.log("Next Steps:");
  console.log("  1. Update .env.local with the new contract addresses");
  console.log("  2. If needed, generate merkle tree: npm run merkle:generate");
  console.log("  3. If needed, update merkle root: npm run update-root");
  console.log("  4. Verify contracts on block explorer");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
