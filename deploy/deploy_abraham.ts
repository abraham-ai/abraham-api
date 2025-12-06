import hre from "hardhat";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config as dotenvConfig } from "dotenv";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// Load .env.local
dotenvConfig({ path: ".env.local" });

/**
 * Deploy AbrahamCovenant and AbrahamAuction contracts to Ethereum Sepolia
 *
 * This deployment script:
 * 1. Deploys AbrahamCovenant NFT contract
 * 2. Deploys AbrahamAuction contract
 * 3. Sets up permissions (covenant approves auction)
 * 4. Starts the covenant
 * 5. Saves ABIs and addresses to lib folder
 * 6. Updates .env file with deployed addresses
 */
async function main() {
  console.log("=== Abraham Contracts Deployment to Sepolia ===\n");

  // Get network config
  const chain = sepolia;
  const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org";

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
  console.log("Network: Sepolia");
  console.log("RPC URL:", rpcUrl);
  console.log("");

  // Get compiled contracts
  const AbrahamCovenant = await hre.artifacts.readArtifact("AbrahamCovenant");
  const AbrahamAuction = await hre.artifacts.readArtifact("AbrahamAuction");

  // ============================================================
  // 1. Deploy AbrahamCovenant
  // ============================================================
  console.log("1️⃣  Deploying AbrahamCovenant...");
  console.log("   Name: Abraham Covenant");
  console.log("   Symbol: ABRAHAM");
  console.log("   Max Supply: 4745 (13 years * 365 days)");
  console.log("   Work Cycle: 6 days (rest on 7th)");
  console.log("   Abraham: ", account.address);
  console.log("");

  const covenantHash = await client.deployContract({
    abi: AbrahamCovenant.abi as any,
    bytecode: AbrahamCovenant.bytecode as `0x${string}`,
    args: [
      "Abraham Covenant",           // _name
      "ABRAHAM",                     // _symbol
      account.address,               // _owner (deployer)
      account.address,               // _abraham (for testing, use same address)
      4745n,                         // _maxSupply (13 years * 365 days)
      6n,                            // _daysOfWork (6 days work, 1 day rest)
    ],
  });

  console.log("   Transaction hash:", covenantHash);
  console.log("   Waiting for confirmation...");

  const covenantReceipt = await client.waitForTransactionReceipt({ hash: covenantHash });
  const covenantAddress = covenantReceipt.contractAddress;

  if (!covenantAddress) {
    throw new Error("AbrahamCovenant deployment failed - no address returned");
  }

  console.log("   ✅ AbrahamCovenant deployed at:", covenantAddress);
  console.log("   Block number:", covenantReceipt.blockNumber);
  console.log("");

  // ============================================================
  // 2. Deploy AbrahamAuction
  // ============================================================
  console.log("2️⃣  Deploying AbrahamAuction...");
  console.log("   NFT Contract:", covenantAddress);
  console.log("   Owner:", account.address);
  console.log("   Payout Address:", account.address);
  console.log("");

  const auctionHash = await client.deployContract({
    abi: AbrahamAuction.abi as any,
    bytecode: AbrahamAuction.bytecode as `0x${string}`,
    args: [
      covenantAddress,    // _nftContract
      account.address,    // _owner
      account.address,    // _payoutAddress
    ],
  });

  console.log("   Transaction hash:", auctionHash);
  console.log("   Waiting for confirmation...");

  const auctionReceipt = await client.waitForTransactionReceipt({ hash: auctionHash });
  const auctionAddress = auctionReceipt.contractAddress;

  if (!auctionAddress) {
    throw new Error("AbrahamAuction deployment failed - no address returned");
  }

  console.log("   ✅ AbrahamAuction deployed at:", auctionAddress);
  console.log("   Block number:", auctionReceipt.blockNumber);
  console.log("");

  // ============================================================
  // 3. Set up permissions
  // ============================================================
  console.log("3️⃣  Setting up permissions...");
  console.log("   Configuring AbrahamCovenant to allow AbrahamAuction to transfer NFTs");
  console.log("");

  // Update sales mechanic
  console.log("   a) Setting sales mechanic address...");
  const updateMechanicHash = await client.writeContract({
    address: covenantAddress,
    abi: AbrahamCovenant.abi as any,
    functionName: "updateSalesMechanic",
    args: [auctionAddress],
  });
  await client.waitForTransactionReceipt({ hash: updateMechanicHash });
  console.log("      ✅ Sales mechanic set to:", auctionAddress);

  // Set mechanic operator approval
  console.log("   b) Granting operator approval...");
  const setOperatorHash = await client.writeContract({
    address: covenantAddress,
    abi: AbrahamCovenant.abi as any,
    functionName: "setMechanicOperator",
    args: [true],
  });
  await client.waitForTransactionReceipt({ hash: setOperatorHash });
  console.log("      ✅ Operator approval granted");
  console.log("");

  // ============================================================
  // 4. Start the covenant
  // ============================================================
  console.log("4️⃣  Starting the covenant...");
  const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

  const startCovenantHash = await client.writeContract({
    address: covenantAddress,
    abi: AbrahamCovenant.abi as any,
    functionName: "startCovenant",
    args: [currentTimestamp],
  });
  await client.waitForTransactionReceipt({ hash: startCovenantHash });
  console.log("   ✅ Covenant started at:", new Date().toISOString());
  console.log("");

  // ============================================================
  // 5. Save ABIs to lib/abi folder
  // ============================================================
  console.log("5️⃣  Saving ABIs and addresses...");

  const abiDir = join(process.cwd(), "lib", "abi");
  if (!existsSync(abiDir)) {
    mkdirSync(abiDir, { recursive: true });
  }

  // Save AbrahamCovenant ABI
  const covenantAbiPath = join(abiDir, "abrahamCovenant.ts");
  const covenantAbiContent = `// AbrahamCovenant Contract ABI
// Auto-generated by deployment script on ${new Date().toISOString()}
// Deployed to Sepolia at: ${covenantAddress}

export const ABRAHAM_COVENANT_ADDRESS = "${covenantAddress}";

export const ABRAHAM_COVENANT_ABI = ${JSON.stringify(AbrahamCovenant.abi, null, 2)} as const;
`;
  writeFileSync(covenantAbiPath, covenantAbiContent);
  console.log("   ✅ Saved AbrahamCovenant ABI to:", covenantAbiPath);

  // Save AbrahamAuction ABI
  const auctionAbiPath = join(abiDir, "abrahamAuction.ts");
  const auctionAbiContent = `// AbrahamAuction Contract ABI
// Auto-generated by deployment script on ${new Date().toISOString()}
// Deployed to Sepolia at: ${auctionAddress}

export const ABRAHAM_AUCTION_ADDRESS = "${auctionAddress}";

export const ABRAHAM_AUCTION_ABI = ${JSON.stringify(AbrahamAuction.abi, null, 2)} as const;
`;
  writeFileSync(auctionAbiPath, auctionAbiContent);
  console.log("   ✅ Saved AbrahamAuction ABI to:", auctionAbiPath);
  console.log("");

  // ============================================================
  // 6. Save deployment info
  // ============================================================
  const deploymentInfoPath = join(process.cwd(), "lib", "abi", "deployment-info.json");
  const deploymentInfo = {
    network: "sepolia",
    timestamp: new Date().toISOString(),
    deployer: account.address,
    contracts: {
      abrahamCovenant: {
        address: covenantAddress,
        blockNumber: covenantReceipt.blockNumber.toString(),
        txHash: covenantHash,
      },
      abrahamAuction: {
        address: auctionAddress,
        blockNumber: auctionReceipt.blockNumber.toString(),
        txHash: auctionHash,
      },
    },
  };
  writeFileSync(deploymentInfoPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("   ✅ Saved deployment info to:", deploymentInfoPath);
  console.log("");

  // ============================================================
  // 7. Print environment variables to add
  // ============================================================
  console.log("=== Deployment Successful ===\n");
  console.log("📝 Add these to your .env.local file:\n");
  console.log(`# Abraham Contracts (Sepolia)`);
  console.log(`ABRAHAM_COVENANT_ADDRESS=${covenantAddress}`);
  console.log(`ABRAHAM_AUCTION_ADDRESS=${auctionAddress}`);
  console.log(`SEPOLIA_RPC_URL=${rpcUrl}`);
  console.log("");

  console.log("=== Next Steps ===");
  console.log("1. ✅ Contracts deployed and configured");
  console.log("2. ✅ ABIs saved to lib/abi/ folder");
  console.log("3. ✅ Covenant started and ready for daily work");
  console.log("4. ⏳ Add environment variables to .env.local (see above)");
  console.log("5. ⏳ Test the flow:");
  console.log("   - Select a winner on TheSeeds (Base)");
  console.log("   - Call /api/admin/select-winner");
  console.log("   - Winner should be minted on Sepolia");
  console.log("   - Auction should start automatically");
  console.log("");

  console.log("=== Useful Commands ===");
  console.log(`View covenant on Etherscan: https://sepolia.etherscan.io/address/${covenantAddress}`);
  console.log(`View auction on Etherscan: https://sepolia.etherscan.io/address/${auctionAddress}`);
  console.log("");
  console.log("Verify contracts:");
  console.log(`npx hardhat verify --network sepolia ${covenantAddress} "Abraham Covenant" "ABRAHAM" ${account.address} ${account.address} 4745 6`);
  console.log(`npx hardhat verify --network sepolia ${auctionAddress} ${covenantAddress} ${account.address} ${account.address}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
