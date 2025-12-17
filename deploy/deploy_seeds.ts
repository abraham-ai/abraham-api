import hre from "hardhat";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base, sepolia } from "viem/chains";
import { config as dotenvConfig } from "dotenv";

// Load .env.local
dotenvConfig({ path: ".env.local" });

/**
 * Deploy The Seeds contract to L2 (Base/Base Sepolia)
 *
 * This deployment script:
 * 1. Deploys The Seeds governance contract
 * 2. Sets up initial configuration
 * 3. Outputs deployment addresses for integration
 */
async function main() {
  console.log("=== The Seeds Deployment ===\n");

  // Get network name from CLI arguments
  const networkArg = process.argv.find((arg) => arg.startsWith("--network"));
  const networkName = networkArg
    ? networkArg.split("=")[1] || process.argv[process.argv.indexOf(networkArg) + 1]
    : "hardhat";
  console.log("Network:", networkName);

  // Get network config
  let chain;
  let rpcUrl;

  switch (networkName) {
    case "baseSepolia":
      chain = baseSepolia;
      rpcUrl = "https://sepolia.base.org";
      break;
    case "baseMainnet":
      chain = base;
      rpcUrl = "https://mainnet.base.org";
      break;
    case "sepolia":
      chain = sepolia;
      rpcUrl = process.env.SEPOLIA_RPC_URL;
      break;
    default:
      throw new Error(`Unsupported network: ${networkName}`);
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

  // Get compiled contract
  const TheSeeds = await hre.artifacts.readArtifact("TheSeeds");

  // Deploy The Seeds contract
  console.log("\nDeploying The Seeds...");
  const hash = await client.deployContract({
    abi: TheSeeds.abi as any,
    bytecode: TheSeeds.bytecode as `0x${string}`,
    args: [account.address, account.address], // admin address, initial creator address
  });

  console.log("Transaction hash:", hash);
  console.log("Waiting for confirmation...");

  const receipt = await client.waitForTransactionReceipt({ hash });
  const seedsAddress = receipt.contractAddress;

  if (!seedsAddress) {
    throw new Error("Contract deployment failed - no address returned");
  }

  console.log("\n=== Deployment Successful ===");
  console.log("The Seeds deployed at:", seedsAddress);
  console.log("Owner:", account.address);
  console.log("Block number:", receipt.blockNumber);

  console.log("\n=== Next Steps ===");
  console.log("1. Generate Merkle root from FirstWorks snapshot:");
  console.log("   npm run merkle:generate");
  console.log("");
  console.log("2. Update ownership root on The Seeds contract:");
  console.log(
    `   cast send ${seedsAddress} "updateOwnershipRoot(bytes32)" <MERKLE_ROOT> --rpc-url ${rpcUrl} --private-key $PRIVATE_KEY`
  );
  console.log("");
  console.log("3. Configure backend API with contract address:");
  console.log(`   L2_SEEDS_CONTRACT=${seedsAddress}`);
  console.log("");
  console.log("4. Set up daily snapshot and root update cron job");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
