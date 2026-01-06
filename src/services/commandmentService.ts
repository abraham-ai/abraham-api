/**
 * Commandment Service
 *
 * Purpose: Orchestrate commandment (comment) operations including:
 * - IPFS content upload
 * - Blockchain interactions
 * - Eligibility checks
 * - Rate limiting
 *
 * Similar to BlessingService but for commandments (comments on seeds)
 */

import { contractService } from "./contractService.js";
import { blessingService } from "./blessingService.js";
import * as ipfsService from "./ipfsService.js";
import type { Address, Hash } from "viem";

export interface CommandmentData {
  id: number;
  seedId: number;
  commenter: Address;
  ipfsHash: string;
  createdAt: number;
  metadata?: ipfsService.CommandmentMetadata;
  metadataError?: string;
}

export interface CommandmentSubmissionResult {
  success: boolean;
  txHash?: Hash;
  commandmentId?: number;
  ipfsHash?: string;
  error?: string;
}

export interface CommandmentStats {
  nftCount: number;
  dailyCommandmentCount: number;
  remainingCommandments: number;
  commandmentsPerNFT: number;
}

/**
 * Commandment Service
 */
class CommandmentService {
  // Cache for commandment events (5 min TTL like blessings)
  private commandmentEventsCache: {
    data: any[];
    timestamp: number;
  } | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Submit a commandment (comment) on a seed
   * This is the main entry point for commenting
   *
   * Steps:
   * 1. Check if user owns NFTs and can comment
   * 2. Upload message to IPFS
   * 3. Submit to blockchain
   *
   * @param userAddress - User's wallet address
   * @param seedId - Seed to comment on
   * @param message - Comment message text
   * @returns Submission result with transaction hash and commandment ID
   */
  async submitCommandment(
    userAddress: string,
    seedId: number,
    message: string
  ): Promise<CommandmentSubmissionResult> {
    try {
      // 1. Validate input
      if (!userAddress || !message || message.trim().length === 0) {
        return {
          success: false,
          error: "Invalid input: userAddress and message are required"
        };
      }

      if (seedId < 0) {
        return {
          success: false,
          error: "Invalid seedId"
        };
      }

      // 2. Check eligibility (NFT ownership via blessing service)
      const snapshot = await blessingService.getSnapshot();
      if (!snapshot) {
        return {
          success: false,
          error: "Unable to verify NFT ownership: snapshot not loaded"
        };
      }

      const addressLower = userAddress.toLowerCase();
      const tokenIds = snapshot.holderIndex[addressLower] || [];

      if (tokenIds.length === 0) {
        return {
          success: false,
          error: "You must own at least one FirstWorks NFT to comment"
        };
      }

      // 3. Check daily limit from contract
      const dailyCount = await contractService.getUserDailyCommandmentCount(
        userAddress as Address
      );
      const commandmentsPerNFT = 1; // TODO: Read from contract
      const maxCommandments = tokenIds.length * commandmentsPerNFT;

      if (Number(dailyCount) >= maxCommandments) {
        return {
          success: false,
          error: `Daily limit reached: ${dailyCount}/${maxCommandments} commandments used today`
        };
      }

      // 4. Upload to IPFS
      console.log(`📤 Uploading commandment to IPFS for user ${userAddress}...`);
      const uploadResult = await ipfsService.uploadCommandment(
        message,
        userAddress,
        seedId
      );

      if (!uploadResult.success || !uploadResult.ipfsHash) {
        return {
          success: false,
          error: uploadResult.error || "Failed to upload to IPFS"
        };
      }

      console.log(`✅ IPFS upload successful: ${uploadResult.ipfsHash}`);

      // 5. Get Merkle proof for on-chain verification
      const proofData = await this.getTokenIdsAndProof(userAddress);
      if (!proofData) {
        return {
          success: false,
          error: "Unable to generate proof: snapshot or merkle tree not loaded"
        };
      }

      // 6. Submit to blockchain
      console.log(`📝 Submitting commandment to blockchain...`);
      const result = await contractService.commentOnSeedFor(
        seedId,
        userAddress as Address,
        uploadResult.ipfsHash,
        proofData.tokenIds,
        proofData.proof
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error || "Failed to submit to blockchain"
        };
      }

      console.log(`✅ Commandment submitted successfully: ${result.txHash}`);

      // Clear cache to reflect new commandment
      this.commandmentEventsCache = null;

      return {
        success: true,
        txHash: result.txHash,
        commandmentId: result.commandmentId,
        ipfsHash: uploadResult.ipfsHash
      };
    } catch (error) {
      console.error("Error submitting commandment:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred"
      };
    }
  }

  /**
   * Get all commandments for a specific seed
   * Fetches from blockchain and enriches with IPFS metadata
   *
   * @param seedId - Seed ID
   * @returns Array of commandments with metadata
   */
  async getCommandmentsBySeed(seedId: number): Promise<CommandmentData[]> {
    try {
      // Fetch commandments from contract
      const commandments = await contractService.getCommandmentsBySeed(seedId);

      // Enrich with IPFS metadata in parallel
      return await Promise.all(
        commandments.map(async (cmd: any) => {
          let metadata: ipfsService.CommandmentMetadata | undefined;
          let metadataError: string | undefined;

          try {
            // Convert IPFS hash to URL
            const ipfsUrl = ipfsService.ipfsHashToUrl(cmd.ipfsHash);

            // Fetch metadata from IPFS
            const response = await fetch(ipfsUrl);
            if (response.ok) {
              metadata = await response.json();
            } else {
              metadataError = `HTTP ${response.status}`;
            }
          } catch (error) {
            metadataError = error instanceof Error ? error.message : "Failed to fetch metadata";
            console.error(`Error fetching metadata for commandment ${cmd.commandmentId}:`, error);
          }

          return {
            id: Number(cmd.commandmentId),
            seedId: Number(cmd.seedId),
            commenter: cmd.commenter,
            ipfsHash: cmd.ipfsHash,
            createdAt: Number(cmd.timestamp),
            metadata,
            metadataError
          };
        })
      );
    } catch (error) {
      console.error(`Error fetching commandments for seed ${seedId}:`, error);
      return [];
    }
  }

  /**
   * Get all commandment events from blockchain
   * Uses caching to reduce load
   *
   * @returns Array of commandment events
   */
  async getAllCommandmentEvents(): Promise<any[]> {
    const now = Date.now();

    // Return cached data if fresh
    if (
      this.commandmentEventsCache &&
      now - this.commandmentEventsCache.timestamp < this.CACHE_TTL
    ) {
      return this.commandmentEventsCache.data;
    }

    try {
      // Fetch from blockchain
      const events = await contractService.getCommandmentEvents();

      // Update cache
      this.commandmentEventsCache = {
        data: events,
        timestamp: now
      };

      return events;
    } catch (error) {
      console.error("Error fetching commandment events:", error);
      return [];
    }
  }

  /**
   * Get commandment statistics for a user
   *
   * @param userAddress - User's wallet address
   * @returns Commandment stats including limits and usage
   */
  async getCommandmentStats(
    userAddress: string
  ): Promise<CommandmentStats> {
    try {
      // Get NFT count from snapshot
      const snapshot = await blessingService.getSnapshot();
      const addressLower = userAddress.toLowerCase();
      const nftCount = snapshot?.holderIndex[addressLower]?.length || 0;

      // Get daily commandment count from contract
      const dailyCount = await contractService.getUserDailyCommandmentCount(
        userAddress as Address
      );

      // Get remaining commandments
      const remaining = await contractService.getRemainingCommandments(
        userAddress as Address,
        nftCount
      );

      return {
        nftCount,
        dailyCommandmentCount: Number(dailyCount),
        remainingCommandments: Number(remaining),
        commandmentsPerNFT: 1 // TODO: Read from contract
      };
    } catch (error) {
      console.error(`Error fetching commandment stats for ${userAddress}:`, error);
      return {
        nftCount: 0,
        dailyCommandmentCount: 0,
        remainingCommandments: 0,
        commandmentsPerNFT: 1
      };
    }
  }

  /**
   * Get commandments by a specific user
   *
   * @param userAddress - User's wallet address
   * @returns Array of commandments by this user
   */
  async getCommandmentsByUser(userAddress: string): Promise<CommandmentData[]> {
    try {
      const events = await contractService.getCommandmentEvents({
        userAddress: userAddress as Address
      });

      // Enrich with metadata
      return await Promise.all(
        events.map(async (event: any) => {
          let metadata: ipfsService.CommandmentMetadata | undefined;
          let metadataError: string | undefined;

          try {
            const ipfsUrl = ipfsService.ipfsHashToUrl(event.ipfsHash);
            const response = await fetch(ipfsUrl);
            if (response.ok) {
              metadata = await response.json();
            } else {
              metadataError = `HTTP ${response.status}`;
              console.error(`Failed to fetch metadata for commandment ${event.commandmentId}: HTTP ${response.status} from ${ipfsUrl}`);
            }
          } catch (error) {
            metadataError = error instanceof Error ? error.message : "Failed to fetch";
            console.error(`Error fetching metadata for commandment ${event.commandmentId}:`, error);
          }

          return {
            id: Number(event.commandmentId),
            seedId: Number(event.seedId),
            commenter: event.commenter,
            ipfsHash: event.ipfsHash,
            createdAt: Number(event.timestamp),
            metadata,
            metadataError
          };
        })
      );
    } catch (error) {
      console.error(`Error fetching commandments for user ${userAddress}:`, error);
      return [];
    }
  }

  /**
   * Check if a user can submit a commandment
   *
   * @param userAddress - User's wallet address
   * @returns Object with canComment boolean and reason if not
   */
  async canComment(userAddress: string): Promise<{
    canComment: boolean;
    reason?: string;
    nftCount: number;
    dailyCount: number;
    maxAllowed: number;
  }> {
    try {
      // Get NFT count
      const snapshot = await blessingService.getSnapshot();
      const addressLower = userAddress.toLowerCase();
      const nftCount = snapshot?.holderIndex[addressLower]?.length || 0;

      if (nftCount === 0) {
        return {
          canComment: false,
          reason: "You must own at least one FirstWorks NFT to comment",
          nftCount: 0,
          dailyCount: 0,
          maxAllowed: 0
        };
      }

      // Get daily count
      const dailyCount = await contractService.getUserDailyCommandmentCount(
        userAddress as Address
      );

      const commandmentsPerNFT = 1; // TODO: Read from contract
      const maxAllowed = nftCount * commandmentsPerNFT;

      if (Number(dailyCount) >= maxAllowed) {
        return {
          canComment: false,
          reason: `Daily limit reached: ${dailyCount}/${maxAllowed} commandments used`,
          nftCount,
          dailyCount: Number(dailyCount),
          maxAllowed
        };
      }

      return {
        canComment: true,
        nftCount,
        dailyCount: Number(dailyCount),
        maxAllowed
      };
    } catch (error) {
      console.error(`Error checking if user can comment:`, error);
      return {
        canComment: false,
        reason: "Error checking eligibility",
        nftCount: 0,
        dailyCount: 0,
        maxAllowed: 0
      };
    }
  }

  /**
   * Get token IDs and Merkle proof for a user
   * Private helper method that uses blessingService
   */
  private async getTokenIdsAndProof(
    walletAddress: string
  ): Promise<{ tokenIds: number[]; proof: string[] } | null> {
    try {
      const snapshot = await blessingService.getSnapshot();
      if (!snapshot) {
        console.error("Snapshot not loaded");
        return null;
      }

      // Load merkle tree (reuse pattern from blessingService)
      const { loadMerkleTree } = await import("../../lib/snapshots/merkleTreeGenerator.js");
      const merkleTree = await loadMerkleTree();

      if (!merkleTree) {
        console.error("Merkle tree not loaded");
        return null;
      }

      const addressLower = walletAddress.toLowerCase();

      // Get token IDs from snapshot
      const tokenIds = snapshot.holderIndex[addressLower] || [];

      // Get Merkle proof
      const proof = merkleTree.proofs[addressLower] || [];

      if (tokenIds.length === 0) {
        return null; // User owns no NFTs
      }

      return { tokenIds, proof };
    } catch (error) {
      console.error("Error getting token IDs and proof:", error);
      return null;
    }
  }

  /**
   * Clear commandment events cache
   * Useful after submitting new commandments
   */
  clearCache(): void {
    this.commandmentEventsCache = null;
  }
}

export const commandmentService = new CommandmentService();
