/**
 * Smart Contract Interaction Service
 *
 * Handles all interactions with AbrahamSeeds contract on Base Sepolia/Base Mainnet
 * Updated for the new EdenAgent-based AbrahamSeeds contract
 */

// CRITICAL: Load environment variables FIRST before any other code runs
// This ensures env vars are available during service initialization
if (process.env.NODE_ENV !== 'production') {
  const dotenv = await import('dotenv');
  dotenv.config({ path: '.env' });
  dotenv.config({ path: '.env.local', override: true });
}

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  encodeAbiParameters,
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

// Load the ABI from source-tracked file
// Supports both new AbrahamSeeds and old TheSeeds ABIs
let SEEDS_ABI: any;
let IS_NEW_CONTRACT = true;

try {
  const abiPath = join(__dirname, "../../lib/abi/AbrahamSeeds.json");
  SEEDS_ABI = JSON.parse(readFileSync(abiPath, "utf-8"));
  console.log("📄 Loaded AbrahamSeeds ABI (new contract)");
} catch {
  try {
    const oldAbiPath = join(__dirname, "../../lib/abi/TheSeeds.json");
    SEEDS_ABI = JSON.parse(readFileSync(oldAbiPath, "utf-8"));
    IS_NEW_CONTRACT = false;
    console.log("📄 Loaded TheSeeds ABI (legacy contract)");
  } catch {
    throw new Error("No contract ABI found. Run 'npm run compile' first.");
  }
}

// New Seed interface matching AbrahamSeeds contract
export interface Seed {
  id: bigint;
  creator: Address;
  ipfsHash: string;
  blessings: bigint;      // reactionCount in new contract
  score: bigint;          // reactionScore in new contract
  commandmentCount: bigint;
  createdAt: bigint;
  submittedInRound: bigint;
  creationRound: bigint;  // selectedInPeriod in new contract
  isRetracted: boolean;
  // Legacy compatibility fields
  isWinner: boolean;
  winnerInRound: bigint;
}

export interface Blessing {
  seedId: bigint;
  blesser: Address;
  score: bigint;
  timestamp: bigint;
}

export interface Commandment {
  id: bigint;
  seedId: bigint;
  author: Address;
  ipfsHash: string;
  createdAt: bigint;
}

/**
 * Contract Service for interacting with AbrahamSeeds contract
 */
class ContractService {
  private publicClient: PublicClient;
  private walletClient: WalletClient | null = null;
  private contractAddress: Address;
  private relayerAccount: ReturnType<typeof privateKeyToAccount> | null = null;
  private deploymentBlock: bigint;

  constructor() {
    // Get configuration from environment
    const network = process.env.NETWORK || "baseSepolia";
    const rpcUrl = process.env.L2_RPC_URL;
    const contractAddress =
      process.env.L2_SEEDS_CONTRACT ||
      "0x81901f757fd6b3c37e5391dbe6fa0affe9a181b5";
    const relayerKey = process.env.RELAYER_PRIVATE_KEY;
    const deploymentBlock = process.env.L2_SEEDS_DEPLOYMENT_BLOCK || "35963162";

    console.log("🔍 ContractService initialization:");
    console.log(`   Network: ${network}`);
    console.log(`   RPC URL: ${rpcUrl ? "✅ Set" : "❌ Not set"}`);
    console.log(`   Contract: ${contractAddress}`);
    console.log(`   Relayer Key: ${relayerKey ? "✅ Set" : "❌ Not set"}`);
    console.log(`   Deployment Block: ${deploymentBlock}`);
    console.log(`   Contract Type: ${IS_NEW_CONTRACT ? "AbrahamSeeds (new)" : "TheSeeds (legacy)"}`);

    if (!contractAddress) {
      throw new Error("L2_SEEDS_CONTRACT environment variable not set");
    }

    this.contractAddress = contractAddress as Address;
    this.deploymentBlock = BigInt(deploymentBlock);

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
        (relayerKey.startsWith("0x")
          ? relayerKey
          : `0x${relayerKey}`) as `0x${string}`
      );

      this.walletClient = createWalletClient({
        account: this.relayerAccount,
        chain,
        transport: http(rpcUrl),
      });

      console.log(
        `✅ Contract service initialized with relayer: ${this.relayerAccount.address}`
      );
    } else {
      console.warn(
        "⚠️  RELAYER_PRIVATE_KEY not set - backend-signed operations disabled"
      );
    }

    console.log(
      `📄 Connected to contract at: ${this.contractAddress}`
    );
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
   * Encode merkle proof as bytes for the new contract
   */
  private encodeMerkleProof(merkleProof: string[]): `0x${string}` {
    // The new contract expects the proof as abi.encode(bytes32[])
    return encodeAbiParameters(
      [{ type: 'bytes32[]' }],
      [merkleProof as `0x${string}`[]]
    );
  }

  /*//////////////////////////////////////////////////////////////
                          READ FUNCTIONS
  //////////////////////////////////////////////////////////////*/

  /**
   * Read: Get seed information
   */
  async getSeed(seedId: number): Promise<Seed> {
    const seed = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getSeed",
      args: [BigInt(seedId)],
    }) as any;

    // Map to unified Seed interface (works with both old and new contracts)
    if (IS_NEW_CONTRACT) {
      return {
        id: seed.id,
        creator: seed.creator,
        ipfsHash: seed.ipfsHash,
        blessings: seed.blessings,
        score: seed.score,
        commandmentCount: seed.commandmentCount,
        createdAt: seed.createdAt,
        submittedInRound: seed.submittedInRound,
        creationRound: seed.creationRound,
        isRetracted: seed.isRetracted,
        // Legacy compatibility
        isWinner: seed.creationRound > 0n,
        winnerInRound: seed.creationRound,
      };
    } else {
      // Legacy TheSeeds format
      return seed as Seed;
    }
  }

  /**
   * Read: Check if delegate is approved for user
   */
  async isDelegate(
    userAddress: Address,
    delegateAddress: Address
  ): Promise<boolean> {
    const funcName = IS_NEW_CONTRACT ? "delegateApprovals" : "isDelegate";
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: funcName,
      args: [userAddress, delegateAddress],
    })) as boolean;
  }

  /**
   * Read: Get blessing count for a user on a specific seed
   */
  async getBlessingCount(
    userAddress: Address,
    seedId: number
  ): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getBlessingCount",
      args: [userAddress, BigInt(seedId)],
    })) as bigint;
  }

  /**
   * Read: Get total seed count
   */
  async getSeedCount(): Promise<bigint> {
    const funcName = IS_NEW_CONTRACT ? "getSeedCount" : "seedCount";
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: funcName,
      args: [],
    })) as bigint;
  }

  /**
   * Read: Get current round number
   */
  async getCurrentRound(): Promise<bigint> {
    const funcName = IS_NEW_CONTRACT ? "getCurrentRound" : "currentRound";
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: funcName,
      args: [],
    })) as bigint;
  }

  /**
   * Read: Get seeds by round number (uses events for efficiency)
   */
  async getSeedsByRound(round: number): Promise<Seed[]> {
    const eventName = IS_NEW_CONTRACT ? "SeedSubmitted" : "SeedSubmitted";

    const events = await this.publicClient.getContractEvents({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      eventName,
      fromBlock: this.deploymentBlock,
      toBlock: "latest",
    });

    // Filter events for this round and fetch seed data
    const seedPromises = events
      .map((event: any) => event.args as { seedId: bigint })
      .map(async (args) => {
        const seed = await this.getSeed(Number(args.seedId));
        if (Number(seed.submittedInRound) === round) {
          return seed;
        }
        return null;
      });

    const allSeeds = await Promise.all(seedPromises);
    return allSeeds.filter((s): s is Seed => s !== null);
  }

  /**
   * Read: Get seeds from current round
   */
  async getCurrentRoundSeeds(): Promise<Seed[]> {
    const currentRound = await this.getCurrentRound();
    return this.getSeedsByRound(Number(currentRound));
  }

  /**
   * Read: Get time remaining until voting period ends
   */
  async getTimeUntilPeriodEnd(): Promise<bigint> {
    const funcName = IS_NEW_CONTRACT ? "getTimeUntilRoundEnd" : "getTimeUntilPeriodEnd";
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: funcName,
      args: [],
    })) as bigint;
  }

  /**
   * Read: Get current leading seed and its blessing score
   */
  async getCurrentLeader(): Promise<{ leadingSeedId: bigint; score: bigint }> {
    const leaders = await this.getCurrentLeaders();
    const leadingSeedId = leaders.leadingSeedIds.length > 0 ? leaders.leadingSeedIds[0] : 0n;
    return { leadingSeedId, score: leaders.score };
  }

  /**
   * Read: Get blessing score for a specific seed
   */
  async getSeedBlessingScore(seedId: number): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getSeedBlessingScore",
      args: [BigInt(seedId)],
    })) as bigint;
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
   * Read: Get remaining blessings for a user
   */
  async getRemainingBlessings(
    userAddress: Address,
    nftCount: number
  ): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getRemainingBlessings",
      args: [userAddress, BigInt(nftCount)],
    })) as bigint;
  }

  /**
   * Read: Get blessings per NFT configuration
   */
  async getBlessingsPerNFT(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "blessingsPerNFT",
      args: [],
    })) as bigint;
  }

  /**
   * Read: Get voting period duration
   */
  async getVotingPeriod(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "votingPeriod",
      args: [],
    })) as bigint;
  }

  /**
   * Read: Get commandment count for a seed
   */
  async getCommandmentCount(seedId: number): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getCommandmentCount",
      args: [BigInt(seedId)],
    })) as bigint;
  }

  /**
   * Read: Get round winner
   */
  async getRoundWinner(round: number): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getRoundWinner",
      args: [BigInt(round)],
    })) as bigint;
  }

  /**
   * Read: Get current leaders (all tied leaders)
   */
  async getCurrentLeaders(): Promise<{
    leadingSeedIds: bigint[];
    score: bigint;
  }> {
    // Get all eligible seeds and find max score
    const totalSeeds = await this.getSeedCount();
    let maxScore = 0n;
    const leaders: bigint[] = [];

    for (let i = 0; i < Number(totalSeeds); i++) {
      const seedId = BigInt(i);
      const seed = await this.getSeed(Number(seedId));

      // Skip winners and retracted seeds
      if (seed.isWinner || seed.isRetracted) continue;

      const seedScore = seed.score;

      if (seedScore > maxScore) {
        maxScore = seedScore;
        leaders.length = 0;
        leaders.push(seedId);
      } else if (seedScore === maxScore && seedScore > 0n) {
        leaders.push(seedId);
      }
    }

    return { leadingSeedIds: leaders, score: maxScore };
  }

  /*//////////////////////////////////////////////////////////////
                        NFT FUNCTIONS (ERC1155)
  //////////////////////////////////////////////////////////////*/

  /**
   * Read: Get token ID for a seed ID
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
   * Read: Get creation edition info
   */
  async getCreationEditionInfo(tokenId: number): Promise<{
    seedId: bigint;
    totalMinted: bigint;
    creatorEditions: bigint;
    curatorEditions: bigint;
    curatorDistributed: bigint;
    publicEditions: bigint;
    publicSold: bigint;
    availableForSale: bigint;
  }> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getCreationEditionInfo",
      args: [BigInt(tokenId)],
    }) as any;

    return {
      seedId: result[0],
      totalMinted: result[1],
      creatorEditions: result[2],
      curatorEditions: result[3],
      curatorDistributed: result[4],
      publicEditions: result[5],
      publicSold: result[6],
      availableForSale: result[7],
    };
  }

  /*//////////////////////////////////////////////////////////////
                        BLESSING FUNCTIONS
  //////////////////////////////////////////////////////////////*/

  /**
   * Write: Bless a seed on behalf of a user (operator pattern)
   * Requires OPERATOR_ROLE or user delegation
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
      const tokenIdsBigInt = tokenIds.map((id) => BigInt(id));
      const proofEncoded = this.encodeMerkleProof(merkleProof);

      // Simulate first to catch errors
      await this.publicClient.simulateContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "blessSeedFor",
        args: [BigInt(seedId), userAddress, tokenIdsBigInt, proofEncoded],
        account: this.relayerAccount,
      });

      // Submit transaction
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "blessSeedFor",
        args: [BigInt(seedId), userAddress, tokenIdsBigInt, proofEncoded],
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

      let errorMessage = "Failed to submit blessing";
      if (error.message.includes("NotAuthorized")) {
        errorMessage =
          "Backend not authorized - user must approve backend as delegate";
      } else if (error.message.includes("SessionNotFound")) {
        errorMessage = "Seed does not exist";
      } else if (error.message.includes("SessionAlreadySelected")) {
        errorMessage = "Cannot bless a winning seed";
      } else if (error.message.includes("InvalidGatingProof")) {
        errorMessage = "Invalid NFT ownership proof";
      } else if (error.message.includes("DailyLimitReached")) {
        errorMessage = "Daily blessing limit reached";
      } else if (error.message.includes("NoTokens")) {
        errorMessage = "No NFTs owned";
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Prepare blessing transaction data for client-side signing
   */
  prepareBlessingTransaction(
    seedId: number,
    userAddress: Address,
    tokenIds: number[],
    merkleProof: string[]
  ) {
    const tokenIdsBigInt = tokenIds.map((id) => BigInt(id));
    const proofEncoded = this.encodeMerkleProof(merkleProof);

    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: SEEDS_ABI,
        functionName: "blessSeed",
        args: [BigInt(seedId), tokenIdsBigInt, proofEncoded],
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
    const CREATOR_ROLE =
      "0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7"; // keccak256("CREATOR_ROLE")
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
   */
  async submitSeed(ipfsHash: string): Promise<{
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
      let seedId: number | undefined;
      for (const log of receipt.logs) {
        try {
          if (log.topics[0] && log.topics[1]) {
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
   */
  prepareSeedSubmissionTransaction(ipfsHash: string, creatorAddress: Address) {
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

  /*//////////////////////////////////////////////////////////////
                      WINNER SELECTION FUNCTIONS
  //////////////////////////////////////////////////////////////*/

  /**
   * Admin: Select daily winner (call contract's selectDailyWinner)
   */
  async selectDailyWinner(): Promise<{
    success: boolean;
    winningSeedId?: number;
    tokenId?: number;
    txHash?: Hash;
    error?: string;
    details?: string;
    diagnostics?: {
      currentRound: number;
      seedsInRound: number;
      timeRemaining: number;
      currentLeader: { seedId: number; score: string };
    };
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return {
        success: false,
        error: "Wallet client not initialized - RELAYER_PRIVATE_KEY required",
      };
    }

    try {
      console.log("🔍 Running pre-flight diagnostics...");

      // Check current round
      const currentRound = await this.getCurrentRound();
      console.log(`   Current Round: ${currentRound}`);

      // Check eligible seeds
      const eligibleCount = await this.getEligibleSeedsCount();
      console.log(`   Eligible Seeds: ${eligibleCount}`);

      if (eligibleCount === 0n) {
        return {
          success: false,
          error: "No eligible seeds available for winner selection",
          diagnostics: {
            currentRound: Number(currentRound),
            seedsInRound: 0,
            timeRemaining: 0,
            currentLeader: { seedId: 0, score: "0" },
          },
        };
      }

      // Check time remaining
      const timeRemaining = await this.getTimeUntilPeriodEnd();
      console.log(`   Time Until Period End: ${timeRemaining}s`);

      if (timeRemaining > 0n) {
        return {
          success: false,
          error: `Voting period not ended (${timeRemaining}s remaining)`,
          diagnostics: {
            currentRound: Number(currentRound),
            seedsInRound: Number(eligibleCount),
            timeRemaining: Number(timeRemaining),
            currentLeader: { seedId: 0, score: "0" },
          },
        };
      }

      console.log("✅ Pre-flight checks passed, proceeding with winner selection...");

      // Check relayer balance
      const balance = await this.publicClient.getBalance({
        address: this.relayerAccount.address,
      });
      console.log(`   Relayer Balance: ${Number(balance) / 1e18} ETH`);

      if (balance === 0n) {
        return {
          success: false,
          error: `Relayer account has no balance. Please fund ${this.relayerAccount.address}`,
        };
      }

      // Simulate transaction
      console.log("🔍 Simulating transaction...");
      try {
        await this.publicClient.simulateContract({
          address: this.contractAddress,
          abi: SEEDS_ABI,
          functionName: "selectDailyWinner",
          args: [],
          account: this.relayerAccount,
        });
        console.log("✅ Simulation successful");
      } catch (simError: any) {
        throw new Error(`Simulation failed: ${simError.shortMessage || simError.message}`);
      }

      // Submit transaction
      console.log("📤 Submitting transaction...");
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

      // Parse events to get winner info
      let winningSeedId: number | undefined;
      let tokenId: number | undefined;

      for (const log of receipt.logs) {
        try {
          // CreationMinted event: round, seedId, tokenId
          if (log.topics[0] && log.topics[1] && log.topics[2]) {
            winningSeedId = Number(BigInt(log.topics[2]));
            // tokenId is in the data
            if (log.data && log.data !== '0x') {
              tokenId = Number(BigInt(log.data));
            }
            break;
          }
        } catch (e) {
          // Continue
        }
      }

      return {
        success: true,
        winningSeedId,
        tokenId,
        txHash: hash,
        diagnostics: {
          currentRound: Number(currentRound),
          seedsInRound: Number(eligibleCount),
          timeRemaining: 0,
          currentLeader: { seedId: winningSeedId || 0, score: "N/A" },
        },
      };
    } catch (error: any) {
      console.error("Error selecting daily winner:", error);

      let errorMessage = "Failed to select daily winner";
      if (error.message?.includes("PeriodNotEnded")) {
        errorMessage = "Voting period has not ended yet";
      } else if (error.message?.includes("NoValidSession")) {
        errorMessage = "No valid winner found";
      }

      return {
        success: false,
        error: errorMessage,
        details: error.message,
      };
    }
  }

  /*//////////////////////////////////////////////////////////////
                      COMMANDMENT FUNCTIONS
  //////////////////////////////////////////////////////////////*/

  /**
   * Write: Add commandment on behalf of user
   */
  async addCommandmentFor(
    seedId: number,
    userAddress: Address,
    ipfsHash: string,
    tokenIds: number[],
    merkleProof: string[]
  ): Promise<{
    success: boolean;
    txHash?: Hash;
    commandmentId?: number;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return { success: false, error: "Relayer not configured" };
    }

    try {
      const tokenIdsBigInt = tokenIds.map((id) => BigInt(id));
      const proofEncoded = this.encodeMerkleProof(merkleProof);

      // The new contract uses sendMessage internally via addCommandment
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "addCommandment",
        args: [BigInt(seedId), ipfsHash, tokenIdsBigInt, proofEncoded],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      // Parse CommandmentSubmitted event
      let commandmentId: number | undefined;
      for (const log of receipt.logs) {
        try {
          if (log.topics[0] && log.topics[1]) {
            commandmentId = Number(BigInt(log.topics[1]));
            break;
          }
        } catch (e) {
          // Skip
        }
      }

      return {
        success: receipt.status === "success",
        txHash: hash,
        commandmentId,
      };
    } catch (error: any) {
      console.error("Error adding commandment:", error);

      let errorMessage = "Failed to add commandment";
      if (error.message.includes("DailyLimitReached")) {
        errorMessage = "Daily commandment limit reached";
      } else if (error.message.includes("InvalidGatingProof")) {
        errorMessage = "Invalid NFT ownership proof";
      } else if (error.message.includes("SessionNotFound")) {
        errorMessage = "Seed not found";
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Prepare commandment transaction for client-side signing
   */
  prepareCommandmentTransaction(
    seedId: number,
    userAddress: Address,
    ipfsHash: string,
    tokenIds: number[],
    merkleProof: string[]
  ) {
    const tokenIdsBigInt = tokenIds.map((id) => BigInt(id));
    const proofEncoded = this.encodeMerkleProof(merkleProof);

    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: SEEDS_ABI,
        functionName: "addCommandment",
        args: [BigInt(seedId), ipfsHash, tokenIdsBigInt, proofEncoded],
      }),
      from: userAddress,
      chainId: this.publicClient.chain?.id,
    };
  }

  /*//////////////////////////////////////////////////////////////
                        EDITION FUNCTIONS
  //////////////////////////////////////////////////////////////*/

  /**
   * Write: Reward priests (curators) with editions
   */
  async rewardPriests(
    tokenId: number,
    priests: Address[],
    amounts: number[]
  ): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return { success: false, error: "Relayer not configured" };
    }

    try {
      const amountsBigInt = amounts.map((a) => BigInt(a));

      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "rewardPriests",
        args: [BigInt(tokenId), priests, amountsBigInt],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });

      return {
        success: receipt.status === "success",
        txHash: hash,
      };
    } catch (error: any) {
      console.error("Error rewarding priests:", error);
      return {
        success: false,
        error: error.message || "Failed to reward priests",
      };
    }
  }

  /**
   * Prepare edition purchase transaction
   */
  preparePurchaseTransaction(
    tokenId: number,
    amount: number,
    userAddress: Address,
    value: bigint
  ) {
    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: SEEDS_ABI,
        functionName: "purchaseCreation",
        args: [BigInt(tokenId), BigInt(amount)],
      }),
      from: userAddress,
      value,
      chainId: this.publicClient.chain?.id,
    };
  }

  /**
   * Read: Get edition price
   */
  async getEditionPrice(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "getEditionPrice",
      args: [],
    })) as bigint;
  }

  /*//////////////////////////////////////////////////////////////
                        EVENT FETCHING
  //////////////////////////////////////////////////////////////*/

  /**
   * Fetch blessing events from the blockchain
   */
  async getBlessingEvents(options?: {
    fromBlock?: bigint;
    toBlock?: bigint | "latest";
    userAddress?: Address;
    seedId?: number;
  }): Promise<Blessing[]> {
    const BATCH_SIZE = 50000n;
    const allBlessings: Blessing[] = [];

    try {
      const latestBlock = await this.publicClient.getBlockNumber();
      const fromBlock = options?.fromBlock || this.deploymentBlock;
      const toBlock =
        options?.toBlock === "latest" || !options?.toBlock
          ? latestBlock
          : options.toBlock;

      let currentFrom = fromBlock;

      while (currentFrom <= toBlock) {
        const currentTo =
          currentFrom + BATCH_SIZE > toBlock
            ? toBlock
            : currentFrom + BATCH_SIZE;

        const filter: any = {
          address: this.contractAddress,
          event: {
            type: "event",
            name: "BlessingSubmitted",
            inputs: [
              { indexed: true, name: "seedId", type: "uint256" },
              { indexed: true, name: "blesser", type: "address" },
              { indexed: false, name: "score", type: "uint256" },
            ],
          },
          fromBlock: currentFrom,
          toBlock: currentTo,
        };

        if (options?.seedId !== undefined) {
          filter.args = { seedId: BigInt(options.seedId) };
        }
        if (options?.userAddress) {
          filter.args = { ...filter.args, blesser: options.userAddress };
        }

        const logs = await this.publicClient.getLogs(filter);

        const blessings: Blessing[] = logs.map((log: any) => ({
          seedId: log.args.seedId,
          blesser: log.args.blesser,
          score: log.args.score,
          timestamp: 0n, // Not in new event
        }));

        allBlessings.push(...blessings);
        currentFrom = currentTo + 1n;
      }

      return allBlessings;
    } catch (error) {
      console.error("Error fetching blessing events:", error);
      return [];
    }
  }

  /**
   * Fetch commandment events from blockchain
   */
  async getCommandmentEvents(options?: {
    fromBlock?: bigint;
    toBlock?: bigint | "latest";
    userAddress?: Address;
    seedId?: number;
  }): Promise<Commandment[]> {
    const BATCH_SIZE = 50000n;
    const allCommandments: Commandment[] = [];

    try {
      const latestBlock = await this.publicClient.getBlockNumber();
      const fromBlock = options?.fromBlock || this.deploymentBlock;
      const toBlock =
        options?.toBlock === "latest" || !options?.toBlock
          ? latestBlock
          : options.toBlock;

      let currentFrom = fromBlock;

      while (currentFrom <= toBlock) {
        const currentTo =
          currentFrom + BATCH_SIZE > toBlock
            ? toBlock
            : currentFrom + BATCH_SIZE;

        const filter: any = {
          address: this.contractAddress,
          event: {
            type: "event",
            name: "CommandmentSubmitted",
            inputs: [
              { indexed: true, name: "id", type: "uint256" },
              { indexed: true, name: "seedId", type: "uint256" },
              { indexed: true, name: "author", type: "address" },
              { indexed: false, name: "ipfsHash", type: "string" },
            ],
          },
          fromBlock: currentFrom,
          toBlock: currentTo,
        };

        if (options?.seedId !== undefined) {
          filter.args = { seedId: BigInt(options.seedId) };
        }
        if (options?.userAddress) {
          filter.args = { ...filter.args, author: options.userAddress };
        }

        const logs = await this.publicClient.getLogs(filter);

        const commandments: Commandment[] = logs.map((log: any) => ({
          id: log.args.id,
          seedId: log.args.seedId,
          author: log.args.author,
          ipfsHash: log.args.ipfsHash,
          createdAt: 0n, // Not in new event
        }));

        allCommandments.push(...commandments);
        currentFrom = currentTo + 1n;
      }

      return allCommandments.reverse();
    } catch (error) {
      console.error("Error fetching commandment events:", error);
      return [];
    }
  }

  /**
   * Read: Get commandments for a seed
   */
  async getCommandmentsBySeed(seedId: number): Promise<Commandment[]> {
    return await this.getCommandmentEvents({ seedId });
  }

  /*//////////////////////////////////////////////////////////////
                      LEGACY COMPATIBILITY
  //////////////////////////////////////////////////////////////*/

  // These methods maintain API compatibility with the old contract

  async hasBlessed(userAddress: Address, seedId: number): Promise<boolean> {
    const count = await this.getBlessingCount(userAddress, seedId);
    return count > 0n;
  }

  async getTotalBlessings(): Promise<bigint> {
    // Sum up all blessings from events
    const events = await this.getBlessingEvents();
    return BigInt(events.length);
  }

  async getUserDailyBlessingCount(userAddress: Address): Promise<bigint> {
    // In the new contract, this is tracked differently
    // We calculate remaining blessings instead
    return 0n; // Not directly available in new contract
  }

  // Alias for backward compatibility
  async commentOnSeedFor(
    seedId: number,
    userAddress: Address,
    ipfsHash: string,
    tokenIds: number[],
    merkleProof: string[]
  ) {
    return this.addCommandmentFor(seedId, userAddress, ipfsHash, tokenIds, merkleProof);
  }

  // Simplified round mode check (new contract doesn't have round modes)
  async getRoundMode(): Promise<number> {
    return 0; // Always ROUND_BASED in new contract
  }

  /*//////////////////////////////////////////////////////////////
              LEGACY STUB METHODS (For backward compatibility)
  //////////////////////////////////////////////////////////////*/

  // These methods don't exist in the new contract but are kept for API compatibility
  // They return sensible defaults or throw errors indicating they're not supported

  async getDeadlockStrategy(): Promise<number> {
    return 0; // REVERT - not configurable in new contract
  }

  async getTieBreakingStrategy(): Promise<number> {
    return 0; // LOWEST_ID - not configurable in new contract
  }

  async getSecondsUntilDailyReset(): Promise<bigint> {
    // Calculate seconds until midnight UTC
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return BigInt(Math.floor((midnight.getTime() - now.getTime()) / 1000));
  }

  async getSeedScoreByRound(round: number, seedId: number): Promise<bigint> {
    // In new contract, just get the current seed score
    return this.getSeedBlessingScore(seedId);
  }

  async getUserDailyCommandmentCount(userAddress: Address): Promise<bigint> {
    return 0n; // Not tracked in new contract
  }

  async getRemainingCommandments(userAddress: Address, nftCount: number): Promise<bigint> {
    // In new contract, commandment limits are handled differently
    return BigInt(nftCount); // Return 1 per NFT as default
  }

  async tokenURI(tokenId: number): Promise<string> {
    return (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: SEEDS_ABI,
      functionName: "uri",
      args: [BigInt(tokenId)],
    })) as string;
  }

  // Admin update methods - these throw errors since they're not available in the new contract
  async updateVotingPeriod(newPeriod: number): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    return {
      success: false,
      error: "updateVotingPeriod not supported in AbrahamSeeds - use contract constructor or upgrade",
    };
  }

  async updateBlessingsPerNFT(newAmount: number): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    return {
      success: false,
      error: "updateBlessingsPerNFT not supported in AbrahamSeeds - use contract constructor or upgrade",
    };
  }

  async updateScoreResetPolicy(enabled: boolean): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    return {
      success: false,
      error: "updateScoreResetPolicy not supported in AbrahamSeeds",
    };
  }

  async updateRoundMode(mode: number): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    return {
      success: false,
      error: "updateRoundMode not supported in AbrahamSeeds - always ROUND_BASED",
    };
  }

  async updateTieBreakingStrategy(strategy: number): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    return {
      success: false,
      error: "updateTieBreakingStrategy not supported in AbrahamSeeds",
    };
  }

  async updateDeadlockStrategy(strategy: number): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    return {
      success: false,
      error: "updateDeadlockStrategy not supported in AbrahamSeeds",
    };
  }

  async setBaseURI(baseURI: string): Promise<{
    success: boolean;
    txHash?: Hash;
    error?: string;
  }> {
    if (!this.walletClient || !this.relayerAccount) {
      return { success: false, error: "Wallet client not initialized" };
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "setURI",
        args: [baseURI],
      } as any);

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      return { success: receipt.status === "success", txHash: hash };
    } catch (error: any) {
      return { success: false, error: error.message || "Failed to set base URI" };
    }
  }
}

// Singleton instance
export const contractService = new ContractService();
