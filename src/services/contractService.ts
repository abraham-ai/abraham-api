/**
 * Smart Contract Interaction Service
 *
 * Handles all interactions with TheSeeds contract on Base Sepolia/Base Mainnet
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the ABI from source-tracked file (not artifacts, which is gitignored)
// This ensures the ABI is available in Vercel deployments
// The ABI is extracted from artifacts during build with: npm run extract-abi
const abiPath = join(__dirname, "../../lib/abi/TheSeeds.json");
const SEEDS_ABI = JSON.parse(readFileSync(abiPath, "utf-8"));

export interface Seed {
  id: bigint;
  creator: Address;
  ipfsHash: string;
  blessings: bigint;
  createdAt: bigint;
  isWinner: boolean;
  isRetracted: boolean;
  winnerInRound: bigint;
  submittedInRound: bigint;
}

export interface Blessing {
  seedId: bigint;
  blesser: Address;
  actor: Address;
  timestamp: bigint;
  isDelegated: boolean;
}

/**
 * Contract Service for interacting with TheSeeds contract
 */
class ContractService {
  private publicClient: PublicClient;
  private walletClient: WalletClient | null = null;
  private contractAddress: Address;
  private relayerAccount: ReturnType<typeof privateKeyToAccount> | null = null;

  constructor() {
    // Get configuration from environment
    const network = process.env.NETWORK || "baseSepolia";
    const rpcUrl = process.env.L2_RPC_URL;
    const contractAddress = process.env.L2_SEEDS_CONTRACT;
    const relayerKey = process.env.RELAYER_PRIVATE_KEY;

    if (!contractAddress) {
      throw new Error("L2_SEEDS_CONTRACT environment variable not set");
    }

    this.contractAddress = contractAddress as Address;

    // Set up chain
    const chain = network === "base" ? base : baseSepolia;

    // Create public client for read operations
    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as any;

    // Create wallet client if relayer key is provided
    if (relayerKey) {
      this.relayerAccount = privateKeyToAccount(
        (relayerKey.startsWith("0x") ? relayerKey : `0x${relayerKey}`) as `0x${string}`
      );

      this.walletClient = createWalletClient({
        account: this.relayerAccount,
        chain,
        transport: http(rpcUrl),
      });

      console.log(`✅ Contract service initialized with relayer: ${this.relayerAccount.address}`);
    } else {
      console.warn(
        "⚠️  RELAYER_PRIVATE_KEY not set - backend-signed blessings disabled"
      );
    }

    console.log(`📄 Connected to TheSeeds contract at: ${this.contractAddress}`);
    console.log(`🌐 Network: ${chain.name}`);
  }

  /**
   * Check if the service can submit blessings on behalf of users
   */
  canSubmitBlessings(): boolean {
    return this.walletClient !== null && this.relayerAccount !== null;
  }

  /**
   * Get relayer address
   */
  getRelayerAddress(): Address | null {
    return this.relayerAccount?.address || null;
  }

  /**
   * Read: Get seed information
   */
  async getSeed(seedId: number): Promise<Seed> {
    const seed = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getSeed",
      args: [BigInt(seedId)],
    });

    return seed as unknown as Seed;
  }

  /**
   * Read: Check if user has blessed a seed
   */
  async hasBlessed(userAddress: Address, seedId: number): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "hasBlessed",
      args: [userAddress, BigInt(seedId)],
    })) as boolean;
  }

  /**
   * Read: Check if delegate is approved for user
   */
  async isDelegate(userAddress: Address, delegateAddress: Address): Promise<boolean> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "isDelegate",
      args: [userAddress, delegateAddress],
    })) as boolean;
  }

  /**
   * Read: Get total blessings count
   */
  async getTotalBlessings(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getTotalBlessings",
      args: [],
    })) as bigint;
  }

  /**
   * Read: Get all blessings for a seed
   */
  async getSeedBlessings(seedId: number): Promise<Blessing[]> {
    const blessings = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getSeedBlessings",
      args: [BigInt(seedId)],
    });

    return blessings as unknown as Blessing[];
  }

  /**
   * Read: Get all blessings by a user
   */
  async getUserBlessings(userAddress: Address): Promise<Blessing[]> {
    const blessings = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getUserBlessings",
      args: [userAddress],
    });

    return blessings as unknown as Blessing[];
  }

  /**
   * Read: Get total seed count
   */
  async getSeedCount(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "seedCount",
      args: [],
    })) as bigint;
  }

  /**
   * Read: Get current round number
   */
  async getCurrentRound(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "currentRound",
      args: [],
    })) as bigint;
  }

  /**
   * Read: Get seeds by round number
   */
  async getSeedsByRound(round: number): Promise<Seed[]> {
    const seeds = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getSeedsByRound",
      args: [BigInt(round)],
    });

    return seeds as unknown as Seed[];
  }

  /**
   * Read: Get seeds from current round
   */
  async getCurrentRoundSeeds(): Promise<Seed[]> {
    const seeds = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getCurrentRoundSeeds",
      args: [],
    });

    return seeds as unknown as Seed[];
  }

  /**
   * Read: Get time remaining until voting period ends
   */
  async getTimeUntilPeriodEnd(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getTimeUntilPeriodEnd",
      args: [],
    })) as bigint;
  }

  /**
   * Read: Get current leading seed and its blessing score
   */
  async getCurrentLeader(): Promise<{ leadingSeedId: bigint; score: bigint }> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getCurrentLeader",
      args: [],
    });

    const [leadingSeedId, score] = result as [bigint, bigint];
    return { leadingSeedId, score };
  }

  /**
   * Read: Get blessing score for a specific seed
   */
  async getSeedBlessingScore(seedId: number): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "seedBlessingScore",
      args: [BigInt(seedId)],
    })) as bigint;
  }

  /**
   * Read: Get seed score for a specific round
   */
  async getSeedScoreByRound(round: number, seedId: number): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "seedScoreByRound",
      args: [BigInt(round), BigInt(seedId)],
    })) as bigint;
  }

  /**
   * Read: Get current round mode (ROUND_BASED or NON_ROUND_BASED)
   */
  async getRoundMode(): Promise<number> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getRoundMode",
      args: [],
    })) as number;
  }

  /**
   * Read: Get current tie-breaking strategy
   */
  async getTieBreakingStrategy(): Promise<number> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getTieBreakingStrategy",
      args: [],
    })) as number;
  }

  /**
   * Read: Get current deadlock strategy
   */
  async getDeadlockStrategy(): Promise<number> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getDeadlockStrategy",
      args: [],
    })) as number;
  }

  /**
   * Read: Get eligible seeds count (non-winner, non-retracted)
   */
  async getEligibleSeedsCount(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getEligibleSeedsCount",
      args: [],
    })) as bigint;
  }

  /**
   * Read: Get seconds until daily blessing reset
   */
  async getSecondsUntilDailyReset(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getSecondsUntilDailyReset",
      args: [],
    })) as bigint;
  }

  /**
   * Read: Get current leaders (multiple in case of tie)
   */
  async getCurrentLeaders(): Promise<{ leadingSeedIds: bigint[]; score: bigint }> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getCurrentLeaders",
      args: [],
    });

    const [leadingSeedIds, score] = result as [bigint[], bigint];
    return { leadingSeedIds, score };
  }

  /*//////////////////////////////////////////////////////////////
                        NFT FUNCTIONS (ERC721)
  //////////////////////////////////////////////////////////////*/

  /**
   * Read: Get token ID for a seed ID
   * Returns 0 if seed hasn't won yet
   */
  async getTokenIdBySeedId(seedId: number): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getTokenIdBySeedId",
      args: [BigInt(seedId)],
    })) as bigint;
  }

  /**
   * Read: Get seed ID for a token ID
   * Reverts if token doesn't exist
   */
  async getSeedIdByTokenId(tokenId: number): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getSeedIdByTokenId",
      args: [BigInt(tokenId)],
    })) as bigint;
  }

  /**
   * Read: Get token URI for a token ID
   * Returns IPFS URI pointing to metadata
   */
  async tokenURI(tokenId: number): Promise<string> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "tokenURI",
      args: [BigInt(tokenId)],
    })) as string;
  }

  /*//////////////////////////////////////////////////////////////
                        BLESSING FUNCTIONS
  //////////////////////////////////////////////////////////////*/

  /**
   * Write: Bless a seed on behalf of a user (relayer pattern)
   * Requires RELAYER_ROLE or user delegation
   * Now includes on-chain eligibility verification with NFT ownership proof
   */
  async blessSeedFor(
    seedId: number,
    userAddress: Address,
    tokenIds: number[],
    merkleProof: string[]
  ): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Relayer not configured - set RELAYER_PRIVATE_KEY",
      };
    }

    try {
      // Convert tokenIds to BigInt array and proof to proper format
      const tokenIdsBigInt = tokenIds.map((id) => BigInt(id));
      const proofFormatted = merkleProof as `0x${string}`[];

      // Simulate first to catch errors
      await this.publicClient.simulateContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "blessSeedFor",
        args: [BigInt(seedId), userAddress, tokenIdsBigInt, proofFormatted],
        account: this.relayerAccount,
      });

      // Submit transaction
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "blessSeedFor",
        args: [BigInt(seedId), userAddress, tokenIdsBigInt, proofFormatted],
      } as any);

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error blessing seed:", error);

      // Parse common errors
      let errorMessage = "Failed to submit blessing";
      if (error.message.includes("NotAuthorized")) {
        errorMessage =
          "Backend not authorized - user must approve backend as delegate";
      } else if (error.message.includes("SeedNotFound")) {
        errorMessage = "Seed does not exist";
      } else if (error.message.includes("SeedAlreadyWinner")) {
        errorMessage = "Cannot bless a winning seed";
      } else if (error.message.includes("InvalidMerkleProof")) {
        errorMessage = "Invalid NFT ownership proof";
      } else if (error.message.includes("DailyBlessingLimitReached")) {
        errorMessage = "Daily blessing limit reached";
      } else if (error.message.includes("NoVotingPower")) {
        errorMessage = "No NFTs owned";
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Write: Batch bless multiple seeds (relayer only)
   */
  async batchBlessSeedsFor(
    seedIds: number[],
    userAddresses: Address[]
  ): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Relayer not configured",
      };
    }

    if (seedIds.length !== userAddresses.length) {
      return {
        success: false,
        error: "Seed IDs and user addresses length mismatch",
      };
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "batchBlessSeedsFor",
        args: [seedIds.map((id) => BigInt(id)), userAddresses],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error batch blessing:", error);
      return {
        success: false,
        error: "Failed to batch bless seeds",
      };
    }
  }

  /**
   * Prepare blessing transaction data for client-side signing
   * Returns the data user needs to sign the transaction themselves
   * Now includes NFT ownership proof for on-chain verification
   */
  prepareBlessingTransaction(
    seedId: number,
    userAddress: Address,
    tokenIds: number[],
    merkleProof: string[]
  ) {
    const tokenIdsBigInt = tokenIds.map((id) => BigInt(id));
    const proofFormatted = merkleProof as `0x${string}`[];

    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: SEEDS_ABI,
        functionName: "blessSeed",
        args: [BigInt(seedId), tokenIdsBigInt, proofFormatted],
      }),
      from: userAddress,
      chainId: this.publicClient.chain?.id,
    };
  }

  /**
   * Prepare delegate approval transaction for client-side signing
   */
  prepareDelegateApprovalTransaction(
    userAddress: Address,
    delegateAddress: Address,
    approved: boolean
  ) {
    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: SEEDS_ABI,
        functionName: "approveDelegate",
        args: [delegateAddress, approved],
      }),
      from: userAddress,
      chainId: this.publicClient.chain?.id,
    };
  }

  /*//////////////////////////////////////////////////////////////
                        SEED CREATION FUNCTIONS
  //////////////////////////////////////////////////////////////*/

  /**
   * Check if an address has CREATOR_ROLE
   */
  async hasCreatorRole(address: Address): Promise<boolean> {
    const CREATOR_ROLE = "0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7"; // keccak256("CREATOR_ROLE")
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "hasRole",
      args: [CREATOR_ROLE as `0x${string}`, address],
    })) as boolean;
  }

  /**
   * Write: Submit a seed to the blockchain (backend-signed)
   * Requires relayer to have CREATOR_ROLE
   * Note: Title, description, and image are stored in IPFS metadata
   */
  async submitSeed(
    ipfsHash: string
  ): Promise<{
    success: boolean;
    seedId?: number;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Wallet client not initialized - RELAYER_PRIVATE_KEY not set",
      };
    }

    try {
      // Check if relayer has CREATOR_ROLE
      const hasRole = await this.hasCreatorRole(this.relayerAccount.address);
      if (!hasRole) {
        return {
          success: false,
          error: "Relayer does not have CREATOR_ROLE",
        };
      }

      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "submitSeed",
        args: [ipfsHash],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      if (receipt.status !== "success") {
        return {
          success: false,
          error: "Transaction failed",
        };
      }

      // Get the seed ID from the SeedSubmitted event
      const logs = receipt.logs;
      let seedId: number | undefined;

      for (const log of logs) {
        try {
          // Parse the log to find SeedSubmitted event
          if (log.topics[0] && log.topics[1]) {
            // SeedSubmitted event has seedId as first indexed parameter
            seedId = Number(BigInt(log.topics[1]));
            break;
          }
        } catch (e) {
          // Continue if this log doesn't match
        }
      }

      return {
        success: true,
        seedId,
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error submitting seed:", error);
      return {
        success: false,
        error: error.message || "Failed to submit seed",
      };
    }
  }

  /**
   * Prepare seed submission transaction for client-side signing
   * Note: Title, description, and image are stored in IPFS metadata
   */
  prepareSeedSubmissionTransaction(
    ipfsHash: string,
    creatorAddress: Address
  ) {
    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: SEEDS_ABI,
        functionName: "submitSeed",
        args: [ipfsHash],
      }),
      from: creatorAddress,
      chainId: this.publicClient.chain?.id,
    };
  }

  /**
   * Admin: Add a creator (grant CREATOR_ROLE)
   * Only callable by ADMIN_ROLE
   */
  async addCreator(creatorAddress: Address): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Wallet client not initialized",
      };
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "addCreator",
        args: [creatorAddress],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error adding creator:", error);
      return {
        success: false,
        error: error.message || "Failed to add creator",
      };
    }
  }

  /**
   * Admin: Remove a creator (revoke CREATOR_ROLE)
   * Only callable by ADMIN_ROLE
   */
  async removeCreator(creatorAddress: Address): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Wallet client not initialized",
      };
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "removeCreator",
        args: [creatorAddress],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error removing creator:", error);
      return {
        success: false,
        error: error.message || "Failed to remove creator",
      };
    }
  }

  /*//////////////////////////////////////////////////////////////
                    CONFIGURATION UPDATE FUNCTIONS
  //////////////////////////////////////////////////////////////*/

  /**
   * Admin: Update voting period (deferred until next winner selection)
   * @param newPeriod New voting period in seconds (1 hour to 7 days)
   */
  async updateVotingPeriod(newPeriod: number): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Wallet client not initialized",
      };
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "updateVotingPeriod",
        args: [BigInt(newPeriod)],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error updating voting period:", error);
      return {
        success: false,
        error: error.message || "Failed to update voting period",
      };
    }
  }

  /**
   * Admin: Update blessings per NFT (deferred until next winner selection)
   * @param newAmount New blessings per NFT (1 to 100)
   */
  async updateBlessingsPerNFT(newAmount: number): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Wallet client not initialized",
      };
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "updateBlessingsPerNFT",
        args: [BigInt(newAmount)],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error updating blessings per NFT:", error);
      return {
        success: false,
        error: error.message || "Failed to update blessings per NFT",
      };
    }
  }

  /**
   * Admin: Update score reset policy
   * @param enabled Whether to reset scores at round end
   */
  async updateScoreResetPolicy(enabled: boolean): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Wallet client not initialized",
      };
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "updateScoreResetPolicy",
        args: [enabled],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error updating score reset policy:", error);
      return {
        success: false,
        error: error.message || "Failed to update score reset policy",
      };
    }
  }

  /**
   * Admin: Update round mode
   * @param mode 0 = ROUND_BASED, 1 = NON_ROUND_BASED
   */
  async updateRoundMode(mode: number): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Wallet client not initialized",
      };
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "updateRoundMode",
        args: [mode],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error updating round mode:", error);
      return {
        success: false,
        error: error.message || "Failed to update round mode",
      };
    }
  }

  /**
   * Admin: Update tie-breaking strategy
   * @param strategy 0 = LOWEST_SEED_ID, 1 = EARLIEST_SUBMISSION, 2 = PSEUDO_RANDOM
   */
  async updateTieBreakingStrategy(strategy: number): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Wallet client not initialized",
      };
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "updateTieBreakingStrategy",
        args: [strategy],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error updating tie-breaking strategy:", error);
      return {
        success: false,
        error: error.message || "Failed to update tie-breaking strategy",
      };
    }
  }

  /**
   * Admin: Update deadlock strategy
   * @param strategy 0 = REVERT, 1 = SKIP_ROUND
   */
  async updateDeadlockStrategy(strategy: number): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Wallet client not initialized",
      };
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "updateDeadlockStrategy",
        args: [strategy],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error updating deadlock strategy:", error);
      return {
        success: false,
        error: error.message || "Failed to update deadlock strategy",
      };
    }
  }

  /**
   * Admin: Set base URI for token metadata
   * @param baseURI Base URI string (e.g., "https://metadata.example.com/")
   */
  async setBaseURI(baseURI: string): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Wallet client not initialized",
      };
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "setBaseURI",
        args: [baseURI],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error setting base URI:", error);
      return {
        success: false,
        error: error.message || "Failed to set base URI",
      };
    }
  }

  /*//////////////////////////////////////////////////////////////
                      WINNER SELECTION FUNCTIONS
  //////////////////////////////////////////////////////////////*/

  /**
   * Admin: Select daily winner (call contract's selectDailyWinner)
   * Only callable by relayer/admin account
   */
  async selectDailyWinner(): Promise<{
    success: boolean;
    winningSeedId?: number;
    txHash?: Hash;
    error?: string;
    diagnostics?: {
      currentRound: number;
      seedsInRound: number;
      timeRemaining: number;
      currentLeader: { seedId: number; score: string; blessings: string };
    };
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Wallet client not initialized",
      };
    }

    try {
      // ============================================================
      // PRE-FLIGHT DIAGNOSTICS
      // ============================================================
      console.log("🔍 Running pre-flight diagnostics...");

      // Check 1: Get current round
      const currentRound = await this.getCurrentRound();
      console.log(`   Current Round: ${currentRound}`);

      // Check 2: Get seeds in current round
      const roundSeeds = await this.getCurrentRoundSeeds();
      console.log(`   Seeds in Round: ${roundSeeds.length}`);

      if (roundSeeds.length === 0) {
        return {
          success: false,
          error: "No seeds submitted in current round",
          diagnostics: {
            currentRound: Number(currentRound),
            seedsInRound: 0,
            timeRemaining: 0,
            currentLeader: { seedId: 0, score: "0", blessings: "0" },
          },
        };
      }

      // Check 3: Get time remaining
      const timeRemaining = await this.getTimeUntilPeriodEnd();
      console.log(`   Time Until Period End: ${timeRemaining}s`);

      if (timeRemaining > 0n) {
        return {
          success: false,
          error: `Voting period not ended (${timeRemaining}s remaining)`,
          diagnostics: {
            currentRound: Number(currentRound),
            seedsInRound: roundSeeds.length,
            timeRemaining: Number(timeRemaining),
            currentLeader: { seedId: 0, score: "0", blessings: "0" },
          },
        };
      }

      // Check 4: Get current leader and score
      const leader = await this.getCurrentLeader();
      console.log(`   Leading Seed ID: ${leader.leadingSeedId}`);
      console.log(`   Leading Score: ${leader.score}`);

      // Get the seed details to show blessing count
      let leaderSeed = null;
      if (leader.leadingSeedId > 0n) {
        leaderSeed = await this.getSeed(Number(leader.leadingSeedId));
        console.log(`   Leading Seed Blessings: ${leaderSeed.blessings}`);
      }

      // Check if there are any non-winner seeds with scores > 0
      const eligibleSeeds = roundSeeds.filter(seed => !seed.isWinner);
      console.log(`   Eligible Seeds (not already winners): ${eligibleSeeds.length}`);

      if (eligibleSeeds.length === 0) {
        return {
          success: false,
          error: "All seeds in current round have already won",
          diagnostics: {
            currentRound: Number(currentRound),
            seedsInRound: roundSeeds.length,
            timeRemaining: 0,
            currentLeader: {
              seedId: Number(leader.leadingSeedId),
              score: leader.score.toString(),
              blessings: leaderSeed?.blessings.toString() || "0",
            },
          },
        };
      }

      if (leader.score === 0n) {
        return {
          success: false,
          error: "Leading seed has blessing score of 0 (no valid blessings counted)",
          diagnostics: {
            currentRound: Number(currentRound),
            seedsInRound: roundSeeds.length,
            timeRemaining: 0,
            currentLeader: {
              seedId: Number(leader.leadingSeedId),
              score: "0",
              blessings: leaderSeed?.blessings.toString() || "0",
            },
          },
        };
      }

      console.log("✅ Pre-flight checks passed, proceeding with winner selection...");

      // ============================================================
      // EXECUTE WINNER SELECTION
      // ============================================================
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "selectDailyWinner",
        args: [],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      if (receipt.status !== "success") {
        return {
          success: false,
          error: "Transaction failed",
        };
      }

      // Parse the WinnerSelected event to get the winner ID
      let winningSeedId: number | undefined;
      for (const log of receipt.logs) {
        try {
          // WinnerSelected event has seedId as second indexed parameter
          if (log.topics[0] && log.topics[2]) {
            winningSeedId = Number(BigInt(log.topics[2]));
            break;
          }
        } catch (e) {
          // Continue if this log doesn't match
        }
      }

      return {
        success: true,
        winningSeedId,
        txHash: hash,
        diagnostics: {
          currentRound: Number(currentRound),
          seedsInRound: roundSeeds.length,
          timeRemaining: 0,
          currentLeader: {
            seedId: Number(leader.leadingSeedId),
            score: leader.score.toString(),
            blessings: leaderSeed?.blessings.toString() || "0",
          },
        },
      };
    } catch (error: any) {
      console.error("Error selecting daily winner:", error);

      // Parse common errors
      let errorMessage = "Failed to select daily winner";
      if (error.message?.includes("VotingPeriodNotEnded") || error.message?.includes("BlessingPeriodNotEnded")) {
        errorMessage = "Blessing period has not ended yet (24 hours not elapsed)";
      } else if (error.message?.includes("NoValidWinner")) {
        errorMessage = "No valid winner (contract validation failed)";
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

// Singleton instance
export const contractService = new ContractService();
