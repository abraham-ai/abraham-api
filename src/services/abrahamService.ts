/**
 * Abraham Contracts Service
 *
 * Handles interactions with AbrahamCovenant and AbrahamAuction contracts on Ethereum Sepolia
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load ABIs (if they exist - will be created after deployment)
let COVENANT_ABI: any = null;
let AUCTION_ABI: any = null;

try {
  const covenantAbiPath = join(__dirname, "../../lib/abi/abrahamCovenant.ts");
  const auctionAbiPath = join(__dirname, "../../lib/abi/abrahamAuction.ts");

  if (existsSync(covenantAbiPath)) {
    // Import and extract the ABI constant
    const covenantModule = await import("../../lib/abi/abrahamCovenant.js");
    COVENANT_ABI = covenantModule.ABRAHAM_COVENANT_ABI;
  }

  if (existsSync(auctionAbiPath)) {
    const auctionModule = await import("../../lib/abi/abrahamAuction.js");
    AUCTION_ABI = auctionModule.ABRAHAM_AUCTION_ABI;
  }
} catch (error) {
  console.warn("⚠️  Abraham contract ABIs not loaded yet. Deploy contracts first.");
}

/**
 * Service for interacting with Abraham contracts on Ethereum Sepolia
 */
class AbrahamService {
  private publicClient: PublicClient;
  private walletClient: WalletClient | null = null;
  private covenantAddress: Address | null = null;
  private auctionAddress: Address | null = null;
  private abrahamAccount: ReturnType<typeof privateKeyToAccount> | null = null;

  constructor() {
    // Get configuration from environment
    const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org";
    const covenantAddress = process.env.ABRAHAM_COVENANT_ADDRESS;
    const auctionAddress = process.env.ABRAHAM_AUCTION_ADDRESS;
    const abrahamKey = process.env.PRIVATE_KEY; // Same key used for deployment

    if (covenantAddress) {
      this.covenantAddress = covenantAddress as Address;
    }

    if (auctionAddress) {
      this.auctionAddress = auctionAddress as Address;
    }

    // Create public client for read operations
    this.publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl),
    }) as any;

    // Create wallet client if Abraham key is provided
    if (abrahamKey) {
      this.abrahamAccount = privateKeyToAccount(
        (abrahamKey.startsWith("0x") ? abrahamKey : `0x${abrahamKey}`) as `0x${string}`
      );

      this.walletClient = createWalletClient({
        account: this.abrahamAccount,
        chain: sepolia,
        transport: http(rpcUrl),
      });

      if (this.covenantAddress && this.auctionAddress) {
        console.log(`✅ Abraham service initialized`);
        console.log(`   Abraham: ${this.abrahamAccount.address}`);
        console.log(`   Covenant: ${this.covenantAddress}`);
        console.log(`   Auction: ${this.auctionAddress}`);
      }
    } else {
      console.warn("⚠️  PRIVATE_KEY not set - Abraham minting disabled");
    }

    console.log(`🌐 Network: Sepolia`);
  }

  /**
   * Check if the service is properly configured
   */
  isConfigured(): boolean {
    return (
      this.walletClient !== null &&
      this.abrahamAccount !== null &&
      this.covenantAddress !== null &&
      this.auctionAddress !== null &&
      COVENANT_ABI !== null &&
      AUCTION_ABI !== null
    );
  }

  /**
   * Get Abraham address
   */
  getAbrahamAddress(): Address | null {
    return this.abrahamAccount?.address || null;
  }

  /**
   * Read: Get total supply of Abraham creations minted
   */
  async getTotalSupply(): Promise<bigint> {
    if (!this.covenantAddress || !COVENANT_ABI) {
      throw new Error("AbrahamCovenant not configured");
    }

    return (await this.publicClient.readContract({
      address: this.covenantAddress,
      abi: COVENANT_ABI,
      functionName: "totalSupply",
      args: [],
    })) as bigint;
  }

  /**
   * Read: Get next token ID that will be minted
   */
  async getNextTokenId(): Promise<bigint> {
    if (!this.covenantAddress || !COVENANT_ABI) {
      throw new Error("AbrahamCovenant not configured");
    }

    return (await this.publicClient.readContract({
      address: this.covenantAddress,
      abi: COVENANT_ABI,
      functionName: "nextTokenId",
      args: [],
    })) as bigint;
  }

  /**
   * Read: Check if covenant is active
   */
  async isCovenantActive(): Promise<boolean> {
    if (!this.covenantAddress || !COVENANT_ABI) {
      throw new Error("AbrahamCovenant not configured");
    }

    return (await this.publicClient.readContract({
      address: this.covenantAddress,
      abi: COVENANT_ABI,
      functionName: "isCovenantActive",
      args: [],
    })) as boolean;
  }

  /**
   * Write: Commit daily work and mint Abraham creation
   * This mints an NFT to the covenant contract with the provided IPFS hash
   */
  async commitDailyWork(ipfsHash: string): Promise<{
    success: boolean;
    tokenId?: number;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.abrahamAccount) {
      return {
        success: false,
        error: "Abraham wallet not initialized - PRIVATE_KEY not set",
      };
    }

    if (!this.covenantAddress || !COVENANT_ABI) {
      return {
        success: false,
        error: "AbrahamCovenant not configured - deploy contracts first",
      };
    }

    try {
      console.log(`📝 Committing daily work with IPFS hash: ${ipfsHash}`);

      // Call commitDailyWork on the covenant contract
      const hash = await this.walletClient.writeContract({
        address: this.covenantAddress,
        abi: COVENANT_ABI,
        functionName: "commitDailyWork",
        args: [ipfsHash],
      } as any);

      console.log(`   Transaction hash: ${hash}`);
      console.log(`   Waiting for confirmation...`);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      if (receipt.status !== "success") {
        return {
          success: false,
          error: "Transaction failed",
        };
      }

      // Parse the NFTMinted event to get the token ID
      let tokenId: number | undefined;
      for (const log of receipt.logs) {
        try {
          // NFTMinted event has tokenId as first indexed parameter
          if (log.topics[0] && log.topics[1]) {
            tokenId = Number(BigInt(log.topics[1]));
            console.log(`   ✅ NFT minted with tokenId: ${tokenId}`);
            break;
          }
        } catch (e) {
          // Continue if this log doesn't match
        }
      }

      return {
        success: true,
        tokenId,
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error committing daily work:", error);

      // Parse common errors
      let errorMessage = "Failed to commit daily work";
      if (error.message?.includes("AlreadyCommittedToday")) {
        errorMessage = "Already committed work today";
      } else if (error.message?.includes("CovenantNotStarted")) {
        errorMessage = "Covenant not started";
      } else if (error.message?.includes("CovenantBroken")) {
        errorMessage = "Covenant has been broken (grace period expired)";
      } else if (error.message?.includes("MustRestBeforeNextWork")) {
        errorMessage = "Must take rest day before next work";
      } else if (error.message?.includes("MaxSupplyExceeded")) {
        errorMessage = "Maximum supply reached";
      } else if (error.message?.includes("EmptyTokenURI")) {
        errorMessage = "IPFS hash cannot be empty";
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Write: Create a daily auction for a specific token
   * @param tokenId - The token ID to auction (from commitDailyWork)
   * @param durationInDays - Duration of the auction in days (default: 1 day)
   * @param minBidInEth - Minimum bid in ETH (default: 0.01 ETH)
   */
  async createDailyAuction(
    tokenId: number,
    durationInDays: number = 1,
    minBidInEth: string = "0.01"
  ): Promise<{
    success: boolean;
    auctionId?: number;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.abrahamAccount) {
      return {
        success: false,
        error: "Abraham wallet not initialized",
      };
    }

    if (!this.auctionAddress || !AUCTION_ABI) {
      return {
        success: false,
        error: "AbrahamAuction not configured - deploy contracts first",
      };
    }

    try {
      const durationInSeconds = BigInt(durationInDays * 24 * 60 * 60); // Convert days to seconds
      const minBid = parseEther(minBidInEth);

      console.log(`🎨 Creating auction for tokenId: ${tokenId}`);
      console.log(`   Duration: ${durationInDays} day(s)`);
      console.log(`   Min bid: ${minBidInEth} ETH`);

      // Create auction (startTime = 0 means start immediately)
      const hash = await this.walletClient.writeContract({
        address: this.auctionAddress,
        abi: AUCTION_ABI,
        functionName: "createAuction",
        args: [BigInt(tokenId), 0n, durationInSeconds, minBid],
      } as any);

      console.log(`   Transaction hash: ${hash}`);
      console.log(`   Waiting for confirmation...`);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      if (receipt.status !== "success") {
        return {
          success: false,
          error: "Transaction failed",
        };
      }

      // Parse the AuctionCreated event to get the auction ID
      let auctionId: number | undefined;
      for (const log of receipt.logs) {
        try {
          // AuctionCreated event has auctionId as first indexed parameter
          if (log.topics[0] && log.topics[1]) {
            auctionId = Number(BigInt(log.topics[1]));
            console.log(`   ✅ Auction created with auctionId: ${auctionId}`);
            break;
          }
        } catch (e) {
          // Continue if this log doesn't match
        }
      }

      return {
        success: true,
        auctionId,
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error creating auction:", error);

      // Parse common errors
      let errorMessage = "Failed to create auction";
      if (error.message?.includes("InvalidTokenId")) {
        errorMessage = "Invalid token ID";
      } else if (error.message?.includes("InvalidDuration")) {
        errorMessage = "Invalid auction duration";
      } else if (error.message?.includes("AuctionAlreadyExists")) {
        errorMessage = "Auction already exists for this token";
      } else if (error.message?.includes("ApprovalMissing")) {
        errorMessage = "Auction contract not approved by covenant";
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Elevate a winning seed to an Abraham creation
   * This combines commitDailyWork + createDailyAuction into a single operation
   *
   * @param winningSeed - The winning seed data from TheSeeds contract
   * @param round - The round number
   */
  async elevateSeedToCreation(
    winningSeed: {
      id: number;
      ipfsHash: string;
      creator: Address;
      blessings: number;
    },
    round: number
  ): Promise<{
    success: boolean;
    tokenId?: number;
    auctionId?: number;
    mintTxHash?: Hash;
    auctionTxHash?: Hash;
    error?: string;
  }> {
    console.log(`\n🌟 Elevating winning seed to Abraham creation`);
    console.log(`   Seed ID: ${winningSeed.id}`);
    console.log(`   Round: ${round}`);
    console.log(`   IPFS Hash: ${winningSeed.ipfsHash}`);
    console.log(`   Blessings: ${winningSeed.blessings}`);
    console.log("");

    // Step 1: Mint the Abraham creation
    console.log("Step 1: Minting Abraham creation...");
    const mintResult = await this.commitDailyWork(winningSeed.ipfsHash);

    if (!mintResult.success || !mintResult.tokenId) {
      return {
        success: false,
        error: `Failed to mint Abraham creation: ${mintResult.error}`,
      };
    }

    console.log(`✅ Abraham creation minted successfully (tokenId: ${mintResult.tokenId})`);
    console.log("");

    // Step 2: Create daily auction
    console.log("Step 2: Creating daily auction...");
    const auctionResult = await this.createDailyAuction(
      mintResult.tokenId,
      1, // 1 day duration
      "0.01" // 0.01 ETH minimum bid
    );

    if (!auctionResult.success || !auctionResult.auctionId) {
      return {
        success: false,
        tokenId: mintResult.tokenId,
        mintTxHash: mintResult.txHash,
        error: `Minted successfully but failed to create auction: ${auctionResult.error}`,
      };
    }

    console.log(`✅ Daily auction created successfully (auctionId: ${auctionResult.auctionId})`);
    console.log("");

    console.log("🎉 Seed elevation complete!");
    console.log(`   Token ID: ${mintResult.tokenId}`);
    console.log(`   Auction ID: ${auctionResult.auctionId}`);
    console.log(`   Mint Tx: https://sepolia.etherscan.io/tx/${mintResult.txHash}`);
    console.log(`   Auction Tx: https://sepolia.etherscan.io/tx/${auctionResult.txHash}`);
    console.log("");

    return {
      success: true,
      tokenId: mintResult.tokenId,
      auctionId: auctionResult.auctionId,
      mintTxHash: mintResult.txHash,
      auctionTxHash: auctionResult.txHash,
    };
  }

  /**
   * Read: Get auction information
   */
  async getAuction(auctionId: number): Promise<any> {
    if (!this.auctionAddress || !AUCTION_ABI) {
      throw new Error("AbrahamAuction not configured");
    }

    return await this.publicClient.readContract({
      address: this.auctionAddress,
      abi: AUCTION_ABI,
      functionName: "getAuction",
      args: [BigInt(auctionId)],
    });
  }

  /**
   * Read: Check if auction is active
   */
  async isAuctionActive(auctionId: number): Promise<boolean> {
    if (!this.auctionAddress || !AUCTION_ABI) {
      throw new Error("AbrahamAuction not configured");
    }

    return (await this.publicClient.readContract({
      address: this.auctionAddress,
      abi: AUCTION_ABI,
      functionName: "isAuctionActive",
      args: [BigInt(auctionId)],
    })) as boolean;
  }
}

// Singleton instance
export const abrahamService = new AbrahamService();
