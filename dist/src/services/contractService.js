/**
 * Smart Contract Interaction Service
 *
 * Handles all interactions with TheSeeds contract on Base Sepolia/Base Mainnet
 */
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";
import { dirname } from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Contract ABI (minimal - only functions we need)
const SEEDS_ABI = parseAbi([
    // Read functions
    "function getSeed(uint256 seedId) view returns (tuple(uint256 id, address creator, string ipfsHash, string title, string description, uint256 votes, uint256 blessings, uint256 createdAt, bool minted, uint256 mintedInRound))",
    "function hasBlessed(address user, uint256 seedId) view returns (bool)",
    "function isDelegate(address user, address delegate) view returns (bool)",
    "function getTotalBlessings() view returns (uint256)",
    "function getSeedBlessings(uint256 seedId) view returns (tuple(uint256 seedId, address blesser, address actor, uint256 timestamp, bool isDelegated)[])",
    "function getUserBlessings(address user) view returns (tuple(uint256 seedId, address blesser, address actor, uint256 timestamp, bool isDelegated)[])",
    "function seedCount() view returns (uint256)",
    // Write functions
    "function blessSeed(uint256 seedId)",
    "function blessSeedFor(uint256 seedId, address blesser)",
    "function batchBlessSeedsFor(uint256[] calldata seedIds, address[] calldata blessers)",
    "function approveDelegate(address delegate, bool approved)",
    // Events
    "event BlessingSubmitted(uint256 indexed seedId, address indexed blesser, address indexed actor, bool isDelegated, uint256 timestamp)",
]);
/**
 * Contract Service for interacting with TheSeeds contract
 */
class ContractService {
    publicClient;
    walletClient = null;
    contractAddress;
    relayerAccount = null;
    constructor() {
        // Get configuration from environment
        const network = process.env.NETWORK || "baseSepolia";
        const rpcUrl = process.env.L2_RPC_URL;
        const contractAddress = process.env.L2_SEEDS_CONTRACT;
        const relayerKey = process.env.RELAYER_PRIVATE_KEY;
        if (!contractAddress) {
            throw new Error("L2_SEEDS_CONTRACT environment variable not set");
        }
        this.contractAddress = contractAddress;
        // Set up chain
        const chain = network === "base" ? base : baseSepolia;
        // Create public client for read operations
        this.publicClient = createPublicClient({
            chain,
            transport: http(rpcUrl),
        });
        // Create wallet client if relayer key is provided
        if (relayerKey) {
            this.relayerAccount = privateKeyToAccount((relayerKey.startsWith("0x") ? relayerKey : `0x${relayerKey}`));
            this.walletClient = createWalletClient({
                account: this.relayerAccount,
                chain,
                transport: http(rpcUrl),
            });
            console.log(`✅ Contract service initialized with relayer: ${this.relayerAccount.address}`);
        }
        else {
            console.warn("⚠️  RELAYER_PRIVATE_KEY not set - backend-signed blessings disabled");
        }
        console.log(`📄 Connected to TheSeeds contract at: ${this.contractAddress}`);
        console.log(`🌐 Network: ${chain.name}`);
    }
    /**
     * Check if the service can submit blessings on behalf of users
     */
    canSubmitBlessings() {
        return this.walletClient !== null && this.relayerAccount !== null;
    }
    /**
     * Get relayer address
     */
    getRelayerAddress() {
        return this.relayerAccount?.address || null;
    }
    /**
     * Read: Get seed information
     */
    async getSeed(seedId) {
        const seed = await this.publicClient.readContract({
            address: this.contractAddress,
            abi: SEEDS_ABI,
            functionName: "getSeed",
            args: [BigInt(seedId)],
        });
        return seed;
    }
    /**
     * Read: Check if user has blessed a seed
     */
    async hasBlessed(userAddress, seedId) {
        return (await this.publicClient.readContract({
            address: this.contractAddress,
            abi: SEEDS_ABI,
            functionName: "hasBlessed",
            args: [userAddress, BigInt(seedId)],
        }));
    }
    /**
     * Read: Check if delegate is approved for user
     */
    async isDelegate(userAddress, delegateAddress) {
        return (await this.publicClient.readContract({
            address: this.contractAddress,
            abi: SEEDS_ABI,
            functionName: "isDelegate",
            args: [userAddress, delegateAddress],
        }));
    }
    /**
     * Read: Get total blessings count
     */
    async getTotalBlessings() {
        return (await this.publicClient.readContract({
            address: this.contractAddress,
            abi: SEEDS_ABI,
            functionName: "getTotalBlessings",
        }));
    }
    /**
     * Read: Get all blessings for a seed
     */
    async getSeedBlessings(seedId) {
        const blessings = await this.publicClient.readContract({
            address: this.contractAddress,
            abi: SEEDS_ABI,
            functionName: "getSeedBlessings",
            args: [BigInt(seedId)],
        });
        return blessings;
    }
    /**
     * Read: Get all blessings by a user
     */
    async getUserBlessings(userAddress) {
        const blessings = await this.publicClient.readContract({
            address: this.contractAddress,
            abi: SEEDS_ABI,
            functionName: "getUserBlessings",
            args: [userAddress],
        });
        return blessings;
    }
    /**
     * Read: Get total seed count
     */
    async getSeedCount() {
        return (await this.publicClient.readContract({
            address: this.contractAddress,
            abi: SEEDS_ABI,
            functionName: "seedCount",
        }));
    }
    /**
     * Write: Bless a seed on behalf of a user (relayer pattern)
     * Requires RELAYER_ROLE or user delegation
     */
    async blessSeedFor(seedId, userAddress) {
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
            });
            // Wait for confirmation
            const receipt = await this.publicClient.waitForTransactionReceipt({
                hash,
            });
            return {
                success: receipt.status === "success",
                txHash: hash,
            };
        }
        catch (error) {
            console.error("Error blessing seed:", error);
            // Parse common errors
            let errorMessage = "Failed to submit blessing";
            if (error.message.includes("AlreadyBlessed")) {
                errorMessage = "User has already blessed this seed";
            }
            else if (error.message.includes("NotAuthorized")) {
                errorMessage =
                    "Backend not authorized - user must approve backend as delegate";
            }
            else if (error.message.includes("SeedNotFound")) {
                errorMessage = "Seed does not exist";
            }
            else if (error.message.includes("SeedAlreadyMinted")) {
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
    async batchBlessSeedsFor(seedIds, userAddresses) {
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
            });
            const receipt = await this.publicClient.waitForTransactionReceipt({
                hash,
            });
            return {
                success: receipt.status === "success",
                txHash: hash,
            };
        }
        catch (error) {
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
    prepareBlessingTransaction(seedId, userAddress) {
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
    prepareDelegateApprovalTransaction(userAddress, delegateAddress, approved) {
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
}
// Singleton instance
export const contractService = new ContractService();
