import { exec } from "child_process";
import { promisify } from "util";
import { config as dotenvConfig } from "dotenv";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);

// Load environment variables
dotenvConfig({ path: ".env.local" });

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

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
 * Verify TheSeeds contract on Basescan/Etherscan
 *
 * This script uses Hardhat's built-in verify task to verify contracts
 * on block explorers. Works with Ethereum, Base Sepolia, and Base Mainnet.
 *
 * Prerequisites:
 * - BASESCAN_API_KEY or ETHERSCAN_API_KEY must be set in .env.local
 * - Contract must be deployed and address saved in deployment-result.json
 *
 * Usage:
 *   npm run verify:seeds                          # Uses network from deployment-result.json
 *   npm run verify:seeds -- --network baseSepolia # Verify on Base Sepolia
 *   npm run verify:seeds -- --network baseMainnet # Verify on Base Mainnet
 *   npm run verify:seeds -- --network sepolia     # Verify on Ethereum Sepolia
 */
async function main() {
  console.log(`${colors.bright}=== TheSeeds Contract Verification ===${colors.reset}\n`);

  // Get network from command line or deployment result
  const networkArg = process.argv.find((arg) => arg.startsWith("--network"));
  let networkName = networkArg
    ? networkArg.split("=")[1] || process.argv[process.argv.indexOf(networkArg) + 1]
    : null;

  // Read deployment result
  const deploymentPath = path.join(process.cwd(), "deployment-result.json");

  if (!fs.existsSync(deploymentPath)) {
    console.error(`${colors.red}❌ Error: deployment-result.json not found${colors.reset}\n`);
    console.log("Please deploy the contract first:");
    console.log(`${colors.blue}  npm run deploy:seeds${colors.reset}\n`);
    process.exit(1);
  }

  const deploymentResult: DeploymentResult = JSON.parse(
    fs.readFileSync(deploymentPath, "utf-8")
  );

  // Use network from deployment if not specified
  if (!networkName) {
    networkName = deploymentResult.network;
    console.log(`${colors.blue}Using network from deployment: ${networkName}${colors.reset}\n`);
  }

  // Map network names to Hardhat network identifiers
  const networkMap: Record<string, string> = {
    sepolia: "sepolia",
    base: "baseMainnet",
    baseMainnet: "baseMainnet",
    baseSepolia: "baseSepolia",
  };

  const hardhatNetwork = networkMap[networkName];
  if (!hardhatNetwork) {
    console.error(`${colors.red}❌ Error: Unsupported network '${networkName}'${colors.reset}\n`);
    console.log("Supported networks: sepolia, baseSepolia, baseMainnet\n");
    process.exit(1);
  }

  // Check API keys
  const requiredKey = hardhatNetwork.includes("base") ? "BASESCAN_API_KEY" : "ETHERSCAN_API_KEY";
  if (!process.env.BASESCAN_API_KEY && !process.env.ETHERSCAN_API_KEY) {
    console.error(`${colors.red}❌ Error: No API key found${colors.reset}\n`);
    console.log("Please add one of these to your .env.local file:");
    console.log(`${colors.blue}  BASESCAN_API_KEY=your_api_key_here${colors.reset}`);
    console.log(`${colors.blue}  ETHERSCAN_API_KEY=your_api_key_here${colors.reset}\n`);
    console.log("Get your API key from:");
    console.log("  • Basescan: https://basescan.org/myapikey");
    console.log("  • Etherscan: https://etherscan.io/myapikey\n");
    process.exit(1);
  }

  // Display deployment information
  console.log(`${colors.bright}Deployment Information:${colors.reset}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Network:           ${colors.green}${deploymentResult.networkName}${colors.reset}`);
  console.log(`Contract Address:  ${colors.green}${deploymentResult.contractAddress}${colors.reset}`);
  console.log(`Deployer:          ${deploymentResult.deployer}`);
  console.log(`Block Explorer:    ${deploymentResult.explorer}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log(`${colors.bright}Constructor Arguments:${colors.reset}`);
  console.log("  _admin (address):          ", deploymentResult.deployer);
  console.log("  _initialCreator (address): ", deploymentResult.deployer);
  console.log();

  // Build verification command using Hardhat's verify task
  const verifyCommand = [
    "npx hardhat verify",
    `--network ${hardhatNetwork}`,
    deploymentResult.contractAddress,
    deploymentResult.deployer, // Constructor arg 1: admin
    deploymentResult.deployer, // Constructor arg 2: initial creator
  ].join(" ");

  console.log(`${colors.bright}Verification Command:${colors.reset}`);
  console.log(`${colors.blue}${verifyCommand}${colors.reset}\n`);
  console.log("Verifying contract...\n");

  try {
    const { stdout, stderr } = await execAsync(verifyCommand);

    if (stdout) console.log(stdout);
    if (stderr && !stderr.includes("Nothing to compile")) console.error(stderr);

    console.log(`${colors.green}${colors.bright}✅ Verification completed successfully!${colors.reset}\n`);
    console.log(`${colors.bright}🔍 View verified contract:${colors.reset}`);
    console.log(`${colors.blue}   ${deploymentResult.explorer}/address/${deploymentResult.contractAddress}#code${colors.reset}\n`);
  } catch (error: any) {
    // Check if already verified
    if (
      error.message.includes("Already Verified") ||
      error.message.includes("already verified")
    ) {
      console.log(`${colors.green}✅ Contract is already verified!${colors.reset}\n`);
      console.log(`${colors.bright}🔍 View verified contract:${colors.reset}`);
      console.log(`${colors.blue}   ${deploymentResult.explorer}/address/${deploymentResult.contractAddress}#code${colors.reset}\n`);
    } else {
      console.error(`${colors.red}${colors.bright}❌ Verification failed:${colors.reset}`);
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.error(error.message);
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      console.log(`${colors.bright}🔍 Troubleshooting:${colors.reset}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`1. Ensure ${requiredKey} is valid in .env.local`);
      console.log("2. Wait a few minutes after deployment before verifying");
      console.log("3. Verify constructor arguments match deployment");
      console.log("4. Check network matches deployment");
      console.log("5. Ensure contract code hasn't been modified since deployment");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});