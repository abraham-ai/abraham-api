import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Deploy The Seeds contract to L2 (Base/Base Sepolia)
 *
 * This deployment script:
 * 1. Deploys The Seeds governance contract
 * 2. Sets up initial configuration
 * 3. Outputs deployment addresses for integration
 */
const deploySeeds: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, network } = hre;
  const { deploy, log } = deployments;
  const { deployer, owner } = await getNamedAccounts();

  log("\n=================================================");
  log("Deploying The Seeds contract");
  log("=================================================\n");

  log(`Network: ${network.name}`);
  log(`Deployer: ${deployer}`);
  log(`Owner: ${owner}`);
  log("");

  // Deploy The Seeds
  const seedsDeployment = await deploy("TheSeeds", {
    from: deployer,
    args: [owner], // Owner address
    log: true,
    waitConfirmations: network.name === "hardhat" ? 1 : 5,
  });

  log(`\n✓ The Seeds deployed at: ${seedsDeployment.address}`);

  // Verify on Etherscan if not on local network
  if (network.name !== "hardhat" && network.name !== "localhost") {
    log("\nVerifying contract on block explorer...");
    try {
      await hre.run("verify:verify", {
        address: seedsDeployment.address,
        constructorArguments: [owner],
      });
      log("✓ Contract verified successfully");
    } catch (error: any) {
      if (error.message.includes("Already Verified")) {
        log("✓ Contract already verified");
      } else {
        log("⚠ Verification failed:", error.message);
      }
    }
  }

  log("\n=================================================");
  log("Deployment Summary");
  log("=================================================");
  log(`The Seeds: ${seedsDeployment.address}`);
  log(`Owner: ${owner}`);
  log(`Network: ${network.name}`);
  log("");

  log("\n=================================================");
  log("Next Steps");
  log("=================================================");
  log("1. Generate Merkle root from FirstWorks snapshot:");
  log("   npm run merkle:generate");
  log("");
  log("2. Update ownership root on The Seeds contract:");
  log(`   npx hardhat updateRoot --contract ${seedsDeployment.address} --network ${network.name}`);
  log("");
  log("3. Configure backend API with contract address:");
  log(`   L2_SEEDS_CONTRACT=${seedsDeployment.address}`);
  log("");
  log("4. Set up daily snapshot and root update cron job");
  log("");
  log("5. (Optional) Deploy L1 Abraham Covenant contract");
  log("");

  return true;
};

export default deploySeeds;
deploySeeds.tags = ["TheSeeds", "all"];
