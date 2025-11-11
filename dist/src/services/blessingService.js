/**
 * Blessing Service
 *
 * Purpose: Orchestrate blessing operations including eligibility checks,
 * blockchain interactions, and rate limiting
 *
 * Logic:
 * - If you own N NFTs, you can perform B×N blessings per 24-hour period
 * - Each 24-hour period starts from midnight UTC
 * - Blessing count resets every 24 hours
 * - Blessings are written to and read from blockchain (TheSeeds contract)
 * - Local tracking ONLY for rate limiting (not blessing records)
 *
 * This implementation uses in-memory storage for rate limiting only.
 * For production, consider using Redis or a database.
 */
import { loadLatestSnapshot, getNFTsForAddress, } from "../../lib/snapshots/firstWorksSnapshot.js";
import { contractService } from "./contractService.js";
// Configuration: How many blessings per NFT owned
const BLESSINGS_PER_NFT = 1;
/**
 * Blessing tracking service
 */
class BlessingService {
    // In-memory storage for rate limiting: walletAddress -> UserBlessingData
    blessingData = new Map();
    snapshot = null;
    lastSnapshotLoad = 0;
    SNAPSHOT_CACHE_MS = 5 * 60 * 1000; // Reload snapshot every 5 minutes
    constructor() {
        // Initialize snapshot on construction
        this.loadSnapshot();
    }
    /**
     * Load or reload the NFT snapshot
     */
    async loadSnapshot() {
        const now = Date.now();
        // Only reload if cache is stale
        if (now - this.lastSnapshotLoad < this.SNAPSHOT_CACHE_MS && this.snapshot) {
            return;
        }
        try {
            this.snapshot = await loadLatestSnapshot();
            this.lastSnapshotLoad = now;
            if (this.snapshot) {
                console.log(`✅ Loaded snapshot: ${this.snapshot.totalHolders} holders, ${this.snapshot.totalSupply} NFTs`);
            }
            else {
                console.warn("⚠️  No snapshot found. Run the snapshot generator first.");
            }
        }
        catch (error) {
            console.error("❌ Error loading snapshot:", error);
        }
    }
    /**
     * Get the current 24-hour period start and end times (UTC)
     */
    getCurrentPeriod() {
        const now = new Date();
        const start = new Date(now);
        start.setUTCHours(0, 0, 0, 0); // Start of today (UTC)
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1); // Start of tomorrow (UTC)
        return { start, end };
    }
    /**
     * Check if a period has expired
     */
    isPeriodExpired(periodEnd) {
        return new Date(periodEnd) <= new Date();
    }
    /**
     * Get NFT count for a wallet address
     */
    async getNFTCount(walletAddress) {
        await this.loadSnapshot();
        if (!this.snapshot) {
            return 0;
        }
        const nfts = getNFTsForAddress(this.snapshot, walletAddress);
        return nfts.length;
    }
    /**
     * Initialize or reset user blessing data
     */
    async initializeUserData(walletAddress) {
        const nftCount = await this.getNFTCount(walletAddress);
        const maxBlessings = nftCount * BLESSINGS_PER_NFT;
        const { start, end } = this.getCurrentPeriod();
        const data = {
            walletAddress: walletAddress.toLowerCase(),
            nftCount,
            maxBlessings,
            usedBlessings: 0,
            periodStart: start.toISOString(),
            periodEnd: end.toISOString(),
        };
        this.blessingData.set(walletAddress.toLowerCase(), data);
        return data;
    }
    /**
     * Get user blessing data (creates/resets if needed)
     */
    async getUserData(walletAddress) {
        const addressLower = walletAddress.toLowerCase();
        let data = this.blessingData.get(addressLower);
        // If no data exists or period has expired, initialize/reset
        if (!data || this.isPeriodExpired(data.periodEnd)) {
            data = await this.initializeUserData(walletAddress);
        }
        return data;
    }
    /**
     * Check if a user is eligible to bless
     */
    async canBless(walletAddress) {
        const data = await this.getUserData(walletAddress);
        const remainingBlessings = data.maxBlessings - data.usedBlessings;
        const eligible = remainingBlessings > 0;
        let reason;
        if (!eligible) {
            if (data.nftCount === 0) {
                reason = "No NFTs owned";
            }
            else {
                reason = "All blessings used for this period";
            }
        }
        return {
            eligible,
            nftCount: data.nftCount,
            maxBlessings: data.maxBlessings,
            usedBlessings: data.usedBlessings,
            remainingBlessings,
            periodEnd: data.periodEnd,
            reason,
        };
    }
    /**
     * Perform a blessing onchain (backend-signed, gasless for user)
     * This is the main method that orchestrates the entire blessing flow
     */
    async performBlessingOnchain(walletAddress, seedId) {
        // 1. Check eligibility (NFT ownership + rate limits)
        const eligibility = await this.canBless(walletAddress);
        if (!eligibility.eligible) {
            return {
                success: false,
                remainingBlessings: eligibility.remainingBlessings,
                error: eligibility.reason,
            };
        }
        // 2. Check if backend can submit blessings
        if (!contractService.canSubmitBlessings()) {
            return {
                success: false,
                error: "Backend blessing service not configured (RELAYER_PRIVATE_KEY not set)",
            };
        }
        // 3. Check if seed exists and is not minted
        try {
            const seed = await contractService.getSeed(seedId);
            if (seed.minted) {
                return {
                    success: false,
                    error: "Cannot bless a minted seed",
                };
            }
        }
        catch (error) {
            return {
                success: false,
                error: "Seed not found",
            };
        }
        // 4. Check if user already blessed this seed (on blockchain)
        const hasBlessed = await contractService.hasBlessed(walletAddress, seedId);
        if (hasBlessed) {
            return {
                success: false,
                error: "You have already blessed this seed",
            };
        }
        // 5. Submit blessing to blockchain
        const result = await contractService.blessSeedFor(seedId, walletAddress);
        if (!result.success) {
            return {
                success: false,
                error: result.error || "Failed to submit blessing to blockchain",
            };
        }
        // 6. Update local tracking (for rate limiting only)
        const data = await this.getUserData(walletAddress);
        data.usedBlessings += 1;
        const remainingBlessings = data.maxBlessings - data.usedBlessings;
        // 7. Get updated seed info from blockchain
        const updatedSeed = await contractService.getSeed(seedId);
        const blockExplorer = process.env.NETWORK === "base"
            ? `https://basescan.org/tx/${result.txHash}`
            : `https://sepolia.basescan.org/tx/${result.txHash}`;
        console.log(`✅ Blessing performed onchain: ${walletAddress} -> seed ${seedId} (${remainingBlessings} remaining)`);
        console.log(`   Tx: ${result.txHash}`);
        return {
            success: true,
            txHash: result.txHash,
            blessingCount: Number(updatedSeed.blessings),
            remainingBlessings,
            blockExplorer,
        };
    }
    /**
     * Prepare a blessing transaction for client-side signing
     * Returns transaction data for user to sign with their wallet
     */
    async prepareBlessingTransaction(walletAddress, seedId) {
        // 1. Check eligibility
        const eligibility = await this.canBless(walletAddress);
        if (!eligibility.eligible) {
            return {
                success: false,
                error: eligibility.reason,
            };
        }
        // 2. Check if seed exists and is not minted
        let seed;
        try {
            seed = await contractService.getSeed(seedId);
            if (seed.minted) {
                return {
                    success: false,
                    error: "Cannot bless a minted seed",
                };
            }
        }
        catch (error) {
            return {
                success: false,
                error: "Seed not found",
            };
        }
        // 3. Check if user already blessed
        const hasBlessed = await contractService.hasBlessed(walletAddress, seedId);
        if (hasBlessed) {
            return {
                success: false,
                error: "You have already blessed this seed",
            };
        }
        // 4. Prepare transaction data
        const transaction = contractService.prepareBlessingTransaction(seedId, walletAddress);
        return {
            success: true,
            transaction,
            seedInfo: {
                id: Number(seed.id),
                title: seed.title,
                creator: seed.creator,
                currentBlessings: Number(seed.blessings),
            },
            userInfo: {
                address: walletAddress,
                nftCount: eligibility.nftCount,
                remainingBlessings: eligibility.remainingBlessings,
            },
        };
    }
    /**
     * Prepare delegate approval transaction for client-side signing
     * Users must approve backend to enable gasless blessings
     */
    async prepareDelegateApprovalTransaction(walletAddress, approved = true) {
        const relayerAddress = contractService.getRelayerAddress();
        if (!relayerAddress) {
            return {
                success: false,
                error: "Backend relayer not configured",
            };
        }
        // Check current delegation status
        const isCurrentlyDelegate = await contractService.isDelegate(walletAddress, relayerAddress);
        // Prepare transaction
        const transaction = contractService.prepareDelegateApprovalTransaction(walletAddress, relayerAddress, approved);
        return {
            success: true,
            transaction,
            delegateAddress: relayerAddress,
            currentStatus: isCurrentlyDelegate ? "Already approved" : "Not yet approved",
        };
    }
    /**
     * Legacy method: Update rate limiting after a blessing
     * Used for backwards compatibility - just updates local rate limit tracking
     * @deprecated This is automatically handled by performBlessingOnchain
     */
    async performBlessing(walletAddress, targetId) {
        // Just update rate limiting
        const data = await this.getUserData(walletAddress);
        data.usedBlessings += 1;
        const remainingBlessings = data.maxBlessings - data.usedBlessings;
        console.log(`✅ Rate limit updated: ${walletAddress} -> ${targetId} (${remainingBlessings} remaining)`);
        return {
            success: true,
            remainingBlessings,
        };
    }
    /**
     * Get blessing stats for a user
     */
    async getBlessingStats(walletAddress) {
        const data = await this.getUserData(walletAddress);
        return {
            nftCount: data.nftCount,
            maxBlessings: data.maxBlessings,
            usedBlessings: data.usedBlessings,
            remainingBlessings: data.maxBlessings - data.usedBlessings,
            periodStart: data.periodStart,
            periodEnd: data.periodEnd,
        };
    }
    /**
     * Get all blessings for a specific seed from blockchain
     * @deprecated Use contractService.getSeedBlessings() directly
     */
    async getBlessingsForSeed(seedId) {
        return await contractService.getSeedBlessings(seedId);
    }
    /**
     * Get all blessings by a specific user from blockchain
     * @deprecated Use contractService.getUserBlessings() directly
     */
    async getBlessingsByUser(userAddress) {
        return await contractService.getUserBlessings(userAddress);
    }
    /**
     * Get total blessing count from blockchain
     * @deprecated Use contractService.getTotalBlessings() directly
     */
    async getTotalBlessingsCount() {
        const total = await contractService.getTotalBlessings();
        return Number(total);
    }
    /**
     * Check if a user has blessed a specific seed (from blockchain)
     * @deprecated Use contractService.hasBlessed() directly
     */
    async hasUserBlessedSeed(userAddress, seedId) {
        return await contractService.hasBlessed(userAddress, seedId);
    }
    /**
     * Get the current snapshot
     */
    async getSnapshot() {
        await this.loadSnapshot();
        return this.snapshot;
    }
    /**
     * Force reload the snapshot (useful after snapshot generation)
     */
    async reloadSnapshot() {
        this.lastSnapshotLoad = 0;
        await this.loadSnapshot();
    }
}
// Singleton instance
export const blessingService = new BlessingService();
