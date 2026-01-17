// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IGatingModule
 * @notice Interface for pluggable gating/verification modules
 * @dev Agents can implement different gating strategies:
 *      - Merkle proofs (snapshot-based NFT ownership)
 *      - Direct on-chain token balance checks
 *      - Signature-based verification
 *      - Custom verification logic
 *
 * This abstraction allows agents to have different access control mechanisms
 * while sharing the same core protocol logic.
 */
interface IGatingModule {

    /// @notice Gating type identifiers
    enum GatingType {
        NONE,             // No gating required
        MERKLE_PROOF,     // Off-chain snapshot with Merkle proof
        ERC721_BALANCE,   // Direct on-chain ERC721 balance check
        ERC1155_BALANCE,  // Direct on-chain ERC1155 balance check
        ERC20_BALANCE,    // Direct on-chain ERC20 balance check
        SIGNATURE,        // Signature-based verification
        CUSTOM            // Custom implementation
    }

    /// @notice Result of a verification check
    struct VerificationResult {
        bool valid;           // Whether verification passed
        uint256 tokenCount;   // Number of valid tokens (for rate limiting)
        string errorReason;   // Reason if invalid (for debugging)
    }

    // ============ Events ============

    event GatingConfigUpdated(
        GatingType gatingType,
        address indexed tokenContract,
        bytes32 root,
        uint256 timestamp
    );

    // ============ Core Functions ============

    /**
     * @notice Verify that a user has the required tokens/credentials
     * @param user The address to verify
     * @param tokenIds Array of token IDs (interpretation depends on gating type)
     * @param proof Verification data (Merkle proof, signature, etc.)
     * @return result The verification result
     */
    function verify(
        address user,
        uint256[] calldata tokenIds,
        bytes calldata proof
    ) external view returns (VerificationResult memory result);

    /**
     * @notice Get the token count for a user (for rate limiting calculations)
     * @dev For Merkle gating, this returns the count from the last verified proof
     *      For on-chain gating, this queries the token contract directly
     * @param user The address to check
     * @return count Number of tokens/voting power
     */
    function getTokenCount(address user) external view returns (uint256 count);

    /**
     * @notice Get the gating type this module implements
     * @return gatingType The type of gating
     */
    function getGatingType() external view returns (GatingType gatingType);

    /**
     * @notice Get the token contract address (if applicable)
     * @return tokenContract The token contract address (address(0) if not applicable)
     */
    function getTokenContract() external view returns (address tokenContract);

    // ============ Admin Functions ============

    /**
     * @notice Update the Merkle root (for MERKLE_PROOF gating)
     * @param newRoot The new Merkle root
     */
    function updateRoot(bytes32 newRoot) external;

    /**
     * @notice Update the token contract (for on-chain balance gating)
     * @param tokenContract The new token contract address
     */
    function updateTokenContract(address tokenContract) external;
}

/**
 * @title IGatingModuleEvents
 * @notice Events that gating modules should emit
 */
interface IGatingModuleEvents {
    event VerificationSucceeded(address indexed user, uint256 tokenCount);
    event VerificationFailed(address indexed user, string reason);
}
