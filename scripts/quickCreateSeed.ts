import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: '.env.local' });
dotenv.config();

// Load ABI - try AbrahamSeeds first, fall back to TheSeeds
let SEEDS_ABI: any;
let IS_NEW_CONTRACT = true;

try {
  const abiPath = join(__dirname, "../lib/abi/AbrahamSeeds.json");
  SEEDS_ABI = JSON.parse(readFileSync(abiPath, "utf-8"));
  console.log("Using AbrahamSeeds ABI (new contract)");
} catch {
  try {
    const oldAbiPath = join(__dirname, "../lib/abi/TheSeeds.json");
    SEEDS_ABI = JSON.parse(readFileSync(oldAbiPath, "utf-8"));
    IS_NEW_CONTRACT = false;
    console.log("Using TheSeeds ABI (legacy contract)");
  } catch {
    throw new Error("No contract ABI found. Run 'npm run compile' first.");
  }
}

async function main() {
  const ipfsHash = process.argv[2] || "ipfs://QmTestAbrahamSeed" + Date.now();
  const network = process.env.NETWORK || "baseSepolia";
  const contractAddress = process.env.L2_SEEDS_CONTRACT || "0x81901f757fd6b3c37e5391dbe6fa0affe9a181b5";
  const privateKey = (process.env.PRIVATE_KEY?.startsWith("0x") ? process.env.PRIVATE_KEY : `0x${process.env.PRIVATE_KEY}`) as Hex;

  if (!privateKey || privateKey === "0x") {
    throw new Error("PRIVATE_KEY not set in environment");
  }

  const account = privateKeyToAccount(privateKey);
  const chain = network === "base" ? base : baseSepolia;
  const rpcUrl = network === "base"
    ? (process.env.BASE_RPC_URL || "https://mainnet.base.org")
    : (process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org");

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  console.log(`\n🌱 Creating seed on ${network}...`);
  console.log(`   Contract: ${contractAddress}`);
  console.log(`   IPFS Hash: ${ipfsHash}`);
  console.log(`   Signer: ${account.address}`);
  console.log(`   Contract Type: ${IS_NEW_CONTRACT ? "AbrahamSeeds" : "TheSeeds"}\n`);

  try {
    // Check if signer has CREATOR_ROLE (get hash from contract to ensure accuracy)
    const CREATOR_ROLE = await publicClient.readContract({
      address: contractAddress as Address,
      abi: SEEDS_ABI,
      functionName: "CREATOR_ROLE",
    }) as `0x${string}`;
    const hasRole = await publicClient.readContract({
      address: contractAddress as Address,
      abi: SEEDS_ABI,
      functionName: "hasRole",
      args: [CREATOR_ROLE, account.address],
    });

    if (!hasRole) {
      console.error("❌ Signer does not have CREATOR_ROLE!");
      console.log("   Run the following to grant the role:");
      console.log(`   cast send ${contractAddress} "addCreator(address)" ${account.address} --rpc-url ${rpcUrl} --private-key $ADMIN_PRIVATE_KEY`);
      process.exit(1);
    }

    const txHash = await walletClient.writeContract({
      address: contractAddress as Address,
      abi: SEEDS_ABI,
      functionName: "submitSeed",
      args: [ipfsHash],
    });

    console.log(`   Transaction: ${txHash}`);
    console.log(`   Waiting for confirmation...`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== 'success') {
      console.error(`\n❌ Transaction failed!`);
      process.exit(1);
    }

    console.log(`   ✅ Confirmed in block ${receipt.blockNumber}\n`);

    // Get the seed count to determine seed ID
    const funcName = IS_NEW_CONTRACT ? "getSeedCount" : "seedCount";
    const seedCount = await publicClient.readContract({
      address: contractAddress as Address,
      abi: SEEDS_ABI,
      functionName: funcName,
      args: [],
    }) as bigint;

    const seedId = Number(seedCount) - 1;

    // Get current round
    const roundFuncName = IS_NEW_CONTRACT ? "getCurrentRound" : "currentRound";
    const currentRound = await publicClient.readContract({
      address: contractAddress as Address,
      abi: SEEDS_ABI,
      functionName: roundFuncName,
      args: [],
    }) as bigint;

    const explorerUrl = network === "base"
      ? `https://basescan.org/tx/${txHash}`
      : `https://sepolia.basescan.org/tx/${txHash}`;

    console.log(`✅ Seed created successfully!`);
    console.log(`   Seed ID: ${seedId}`);
    console.log(`   Current Round: ${currentRound}`);
    console.log(`   Explorer: ${explorerUrl}\n`);

  } catch (error: any) {
    console.error(`\n❌ Error:`, error.message || error);
    if (error.shortMessage) {
      console.error(`   Details: ${error.shortMessage}`);
    }
    process.exit(1);
  }
}

main();
