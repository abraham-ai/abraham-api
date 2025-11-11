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

// Load the full ABI from contract artifacts
// This avoids issues with parseAbi not handling complex tuple types
const artifactPath = join(__dirname, "../../artifacts/contracts/TheSeeds.sol/TheSeeds.json");
const contractArtifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
const SEEDS_ABI = contractArtifact.abi;

export interface Seed {
  id: bigint;
  creator: Address;
  ipfsHash: string;
  title: string;
  description: string;
  votes: bigint;
  blessings: bigint;
  createdAt: bigint;
  minted: boolean;
  mintedInRound: bigint;
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
   * Write: Bless a seed on behalf of a user (relayer pattern)
   * Requires RELAYER_ROLE or user delegation
   */
  async blessSeedFor(
    seedId: number,
    userAddress: Address
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
      // Simulate first to catch errors
      await this.publicClient.simulateContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "blessSeedFor",
        args: [BigInt(seedId), userAddress],
        account: this.relayerAccount,
      });

      // Submit transaction
      const hash = await this.walletClient.writeContract({
        address: this.contractAddress,
        abi: SEEDS_ABI,
        functionName: "blessSeedFor",
        args: [BigInt(seedId), userAddress],
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
      if (error.message.includes("AlreadyBlessed")) {
        errorMessage = "User has already blessed this seed";
      } else if (error.message.includes("NotAuthorized")) {
        errorMessage =
          "Backend not authorized - user must approve backend as delegate";
      } else if (error.message.includes("SeedNotFound")) {
        errorMessage = "Seed does not exist";
      } else if (error.message.includes("SeedAlreadyMinted")) {
        errorMessage = "Cannot bless a minted seed";
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
   */
  prepareBlessingTransaction(seedId: number, userAddress: Address) {
    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: SEEDS_ABI,
        functionName: "blessSeed",
        args: [BigInt(seedId)],
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
   */
  async submitSeed(
    ipfsHash: string,
    title: string,
    description: string
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
        args: [ipfsHash, title, description],
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
   */
  prepareSeedSubmissionTransaction(
    ipfsHash: string,
    title: string,
    description: string,
    creatorAddress: Address
  ) {
    return {
      to: this.contractAddress,
      data: encodeFunctionData({
        abi: SEEDS_ABI,
        functionName: "submitSeed",
        args: [ipfsHash, title, description],
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
}

// Singleton instance
export const contractService = new ContractService();
