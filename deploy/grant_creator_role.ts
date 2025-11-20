import hre from "hardhat";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base, sepolia } from "viem/chains";
import { config as dotenvConfig } from "dotenv";

// Load .env.local
dotenvConfig({ path: ".env.local" });

/**
 * Grant CREATOR_ROLE to an address on The Seeds contract
 *
 * Usage:
 *   npx hardhat run deploy/grant_creator_role.ts --network baseSepolia
 *
 * Environment variables required:
 *   PRIVATE_KEY - Admin wallet private key
 *   L2_SEEDS_CONTRACT - Deployed Seeds contract address
 *   CREATOR_ADDRESS - Address to grant CREATOR_ROLE (optional, defaults to admin)
 */
async function main() {
  console.log("=== Grant CREATOR_ROLE ===\n");

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

  if (!process.env.L2_SEEDS_CONTRACT) {
    throw new Error("L2_SEEDS_CONTRACT not found in environment variables");
  }

  const contractAddress = process.env.L2_SEEDS_CONTRACT as `0x${string}`;

  // Address to grant CREATOR_ROLE - defaults to the admin wallet itself
  const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY.replace("0x", "")}`);
  const creatorAddress = (process.env.CREATOR_ADDRESS || account.address) as `0x${string}`;

  // Create wallet client
  const client = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  }).extend(publicActions);

  console.log("Admin wallet:", account.address);
  console.log("Contract address:", contractAddress);
  console.log("Granting CREATOR_ROLE to:", creatorAddress);

  // Get compiled contract ABI
  const TheSeeds = await hre.artifacts.readArtifact("TheSeeds");

  // Check if address already has CREATOR_ROLE
  const CREATOR_ROLE = "0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7";

  const hasRole = await client.readContract({
    address: contractAddress,
    abi: TheSeeds.abi,
    functionName: "hasRole",
    args: [CREATOR_ROLE, creatorAddress],
  });

  if (hasRole) {
    console.log("\nAddress already has CREATOR_ROLE!");
    return;
  }

  // Grant CREATOR_ROLE
  console.log("\nGranting CREATOR_ROLE...");
  const hash = await client.writeContract({
    address: contractAddress,
    abi: TheSeeds.abi,
    functionName: "addCreator",
    args: [creatorAddress],
  });

  console.log("Transaction hash:", hash);
  console.log("Waiting for confirmation...");

  const receipt = await client.waitForTransactionReceipt({ hash });

  console.log("\n=== Success ===");
  console.log("CREATOR_ROLE granted to:", creatorAddress);
  console.log("Block number:", receipt.blockNumber);
  console.log("Transaction:", `https://${networkName === "baseMainnet" ? "" : "sepolia."}basescan.org/tx/${hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
