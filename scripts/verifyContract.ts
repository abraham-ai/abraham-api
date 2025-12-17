import { exec } from "child_process";
import { promisify } from "util";
import { config as dotenvConfig } from "dotenv";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);

// Load environment variables
dotenvConfig({ path: ".env.local" });

interface DeploymentResult {
  network: string;
  networkName: string;
  chainId: number;
  contractAddress: string;
  deployer: string;
  explorer: string;
  timestamp: string;
}

/**
 * Verify TheSeeds contract on block explorer
 *
 * This script:
 * 1. Reads deployment info from deployment-result.json
 * 2. Verifies the contract on Basescan using Hardhat verify
 * 3. Supports both Base Sepolia and Base Mainnet
 *
 * Prerequisites:
 * - BASESCAN_API_KEY must be set in .env.local
 * - Contract must be deployed and address saved in deployment-result.json
 *
 * Usage:
 *   npm run verify:contract
 *   npm run verify:contract -- --network baseSepolia
 *   npm run verify:contract -- --network baseMainnet
 */
async function main() {
  console.log("=== Contract Verification Script ===\n");

  // Get network from command line or deployment result
  const networkArg = process.argv.find((arg) => arg.startsWith("--network"));
  let networkName = networkArg
    ? networkArg.split("=")[1] ||
      process.argv[process.argv.indexOf(networkArg) + 1]
    : null;

  // Read deployment result
  const deploymentPath = path.join(process.cwd(), "deployment-result.json");

  if (!fs.existsSync(deploymentPath)) {
    throw new Error(
      "deployment-result.json not found. Please deploy the contract first."
    );
  }

  const deploymentResult: DeploymentResult = JSON.parse(
    fs.readFileSync(deploymentPath, "utf-8")
  );

  // Use network from deployment if not specified
  if (!networkName) {
    networkName = deploymentResult.network;
    console.log(`Using network from deployment-result.json: ${networkName}`);
  }

  // Check API key
  if (!process.env.BASESCAN_API_KEY) {
    console.error(
      "\n❌ Error: BASESCAN_API_KEY not found in environment variables"
    );
    console.log("\nTo verify your contract, you need a Basescan API key:");
    console.log("1. Go to https://basescan.org/myapikey (for mainnet)");
    console.log("   or https://sepolia.basescan.org/myapikey (for testnet)");
    console.log("2. Create an account and generate an API key");
    console.log("3. Add to your .env.local file:");
    console.log("   BASESCAN_API_KEY=your_api_key_here\n");
    process.exit(1);
  }

  console.log("Network:", deploymentResult.networkName);
  console.log("Contract Address:", deploymentResult.contractAddress);
  console.log("Deployer (Constructor Arg):", deploymentResult.deployer);
  console.log("Block Explorer:", deploymentResult.explorer);
  console.log("");

  // Determine the correct network identifier for Hardhat
  const hardhatNetwork =
    networkName === "base" || networkName === "baseMainnet"
      ? "baseMainnet"
      : "baseSepolia";

  // Build verification command
  const verifyCommand = [
    "npx hardhat verify",
    `--network ${hardhatNetwork}`,
    deploymentResult.contractAddress,
    deploymentResult.deployer, // Constructor argument: admin address
  ].join(" ");

  console.log("Running verification command:");
  console.log(verifyCommand);
  console.log("\nThis may take a minute...\n");

  try {
    const { stdout, stderr } = await execAsync(verifyCommand, {
      env: {
        ...process.env,
        BASESCAN_API_KEY: process.env.BASESCAN_API_KEY,
      },
    });

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    console.log("\n✅ Verification completed!");
    console.log(`\nView contract on explorer:`);
    console.log(
      `${deploymentResult.explorer}/address/${deploymentResult.contractAddress}#code`
    );
  } catch (error: any) {
    // Check if already verified
    if (
      error.message.includes("Already Verified") ||
      error.message.includes("already verified")
    ) {
      console.log("\n✅ Contract is already verified!");
      console.log(`\nView contract on explorer:`);
      console.log(
        `${deploymentResult.explorer}/address/${deploymentResult.contractAddress}#code`
      );
    } else {
      console.error("\n❌ Verification failed:");
      console.error(error.message);

      console.log("\n🔍 Troubleshooting tips:");
      console.log("1. Ensure BASESCAN_API_KEY is valid");
      console.log("2. Wait a few minutes after deployment before verifying");
      console.log("3. Check that constructor arguments match deployment");
      console.log("4. Verify you're using the correct network");
      console.log("\nFor manual verification:");
      console.log("Contract: TheSeeds.sol");
      console.log("Compiler: 0.8.28");
      console.log("Optimization: Yes (200 runs)");
      console.log(`Constructor Args: ${deploymentResult.deployer}`);

      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
