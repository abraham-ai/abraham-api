// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IGatingModule
 * @notice Interface for pluggable access control (gating) mechanisms
 * @dev Gating modules verify that users have permission to react/message.
 *      Different implementations support different verification methods:
 *      - MerkleGating: Off-chain snapshot with Merkle proofs
 *      - ERC721Gating: On-chain NFT balance checks
 *      - SignatureGating: Backend-signed permissions
 */
interface IGatingModule {
    /// @notice Result of a gating verification
    struct GatingResult {
        bool valid;               // Whether the user passes gating
        uint256 tokenCount;       // Number of tokens/weight for rate limiting
        string reason;            // Reason for failure (if invalid)
    }

    /// @notice Verify a user's permission to act
    /// @param user The user address to verify
    /// @param tokenIds Token IDs claimed by user (interpretation varies by module)
    /// @param proof Proof data (Merkle proof, signature, etc.)
    /// @return result The verification result
    function verify(
        address user,
        uint256[] calldata tokenIds,
        bytes calldata proof
    ) external view returns (GatingResult memory result);

    /// @notice Get the type identifier for this gating module
    function getGatingType() external pure returns (string memory);

    /// @notice Check if this module requires proof data
    function requiresProof() external pure returns (bool);
}
