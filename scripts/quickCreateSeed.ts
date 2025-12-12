import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config({ path: '.env.local' });
dotenv.config();

const theSeedsAbi = parseAbi([
  "function submitSeed(string memory _ipfsHash) external returns (uint256)",
  "function getCurrentRound() external view returns (uint256)",
  "function getSeed(uint256 _seedId) external view returns (uint256 id, address creator, string ipfsHash, string title, string description, uint256 blessings, uint256 createdAt, bool isWinner, uint256 winnerInRound, uint256 submittedInRound)",
]);

async function main() {
  const ipfsHash = process.argv[2] || "ipfs://QmbVLuJQcNygeeXgsb9QoDDLrqBVUHahhjysRHyPuTd9vy";
  const contractAddress = "0x6b4086d8713477737294968fe397d308664a755a";
  const privateKey = (process.env.PRIVATE_KEY?.startsWith("0x") ? process.env.PRIVATE_KEY : `0x${process.env.PRIVATE_KEY}`) as Hex;

  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL),
  });

  console.log(`\n🌱 Creating seed on Base Sepolia...`);
  console.log(`   IPFS Hash: ${ipfsHash}`);
  console.log(`   Signer: ${account.address}\n`);

  try {
    const txHash = await walletClient.writeContract({
      address: contractAddress as Address,
      abi: theSeedsAbi,
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

    // Get the seed ID from logs (last seed in round)
    const currentRound = await publicClient.readContract({
      address: contractAddress as Address,
      abi: theSeedsAbi,
      functionName: "getCurrentRound",
    }) as bigint;

    console.log(`✅ Seed created successfully!`);
    console.log(`   Explorer: https://sepolia.basescan.org/tx/${txHash}`);
    console.log(`   Current Round: ${currentRound}\n`);

  } catch (error: any) {
    console.error(`\n❌ Error:`, error.message || error);
    process.exit(1);
  }
}

main();
