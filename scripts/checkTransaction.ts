import { createPublicClient, http, Address } from "viem";
import { baseSepolia } from "viem/chains";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

/**
 * Check a transaction to see what happened
 */

async function main() {
  const txHash = process.argv[2] as `0x${string}`;

  if (!txHash) {
    throw new Error("Please provide transaction hash as argument");
  }

  console.log(`\n=== Checking Transaction ${txHash} ===\n`);

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
  });

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

  console.log(`Status: ${receipt.status}`);
  console.log(`Block: ${receipt.blockNumber}`);
  console.log(`Gas Used: ${receipt.gasUsed}`);
  console.log(`From: ${receipt.from}`);
  console.log(`To: ${receipt.to}`);

  console.log(`\nLogs (${receipt.logs.length}):`);
  receipt.logs.forEach((log, i) => {
    console.log(`\nLog ${i + 1}:`);
    console.log(`  Address: ${log.address}`);
    console.log(`  Topics: ${log.topics.length}`);
    log.topics.forEach((topic, j) => {
      console.log(`    ${j}: ${topic}`);
    });
    if (log.data && log.data !== '0x') {
      console.log(`  Data: ${log.data}`);
    }
  });

  // Try to get the transaction itself
  const tx = await publicClient.getTransaction({ hash: txHash });
  console.log(`\nTransaction Input Data:`);
  console.log(tx.input);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error.message || error);
    process.exit(1);
  });
