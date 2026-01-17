// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../../interfaces/IGatingModule.sol";

/**
 * @title MerkleGating
 * @notice Merkle proof-based gating module for off-chain ownership snapshots
 * @dev This module verifies ownership using Merkle proofs generated from
 *      off-chain snapshots of NFT ownership. This is useful when:
 *      - You want to avoid on-chain balance checks (gas savings)
 *      - You need snapshot-based voting (prevent double-voting after transfer)
 *      - The gating token is on a different chain
 */
contract MerkleGating is IGatingModule, Ownable {

    bytes32 public merkleRoot;
    uint256 public rootTimestamp;
    address public tokenContract;

    event RootUpdated(bytes32 indexed previousRoot, bytes32 indexed newRoot, uint256 timestamp);

    error InvalidRoot();
    error ProofVerificationFailed();

    constructor(address admin_, address tokenContract_) Ownable(admin_) {
        tokenContract = tokenContract_;
    }

    // ============ IGatingModule Implementation ============

    /**
     * @inheritdoc IGatingModule
     */
    function verify(
        address user,
        uint256[] calldata tokenIds,
        bytes calldata proof
    ) external view override returns (VerificationResult memory result) {
        if (merkleRoot == bytes32(0)) {
            return VerificationResult({
                valid: false,
                tokenCount: 0,
                errorReason: "No Merkle root set"
            });
        }

        // Decode the proof from bytes to bytes32[]
        bytes32[] memory merkleProof = abi.decode(proof, (bytes32[]));

        // Check for duplicate token IDs
        for (uint256 i = 0; i < tokenIds.length; i++) {
            for (uint256 j = i + 1; j < tokenIds.length; j++) {
                if (tokenIds[i] == tokenIds[j]) {
                    return VerificationResult({
                        valid: false,
                        tokenCount: 0,
                        errorReason: "Duplicate token IDs"
                    });
                }
            }
        }

        // Verify the Merkle proof
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(user, tokenIds))));
        bool isValid = _verifyProof(merkleProof, merkleRoot, leaf);

        if (!isValid) {
            return VerificationResult({
                valid: false,
                tokenCount: 0,
                errorReason: "Invalid Merkle proof"
            });
        }

        return VerificationResult({
            valid: true,
            tokenCount: tokenIds.length,
            errorReason: ""
        });
    }

    /**
     * @inheritdoc IGatingModule
     * @dev For Merkle gating, this returns 0 as we can't determine token count without a proof
     */
    function getTokenCount(address) external pure override returns (uint256) {
        // Cannot determine token count without a proof
        return 0;
    }

    /**
     * @inheritdoc IGatingModule
     */
    function getGatingType() external pure override returns (GatingType) {
        return GatingType.MERKLE_PROOF;
    }

    /**
     * @inheritdoc IGatingModule
     */
    function getTokenContract() external view override returns (address) {
        return tokenContract;
    }

    // ============ Admin Functions ============

    /**
     * @inheritdoc IGatingModule
     */
    function updateRoot(bytes32 newRoot) external override onlyOwner {
        if (newRoot == bytes32(0)) revert InvalidRoot();

        bytes32 previousRoot = merkleRoot;
        merkleRoot = newRoot;
        rootTimestamp = block.timestamp;

        emit RootUpdated(previousRoot, newRoot, block.timestamp);
        emit GatingConfigUpdated(GatingType.MERKLE_PROOF, tokenContract, newRoot, block.timestamp);
    }

    /**
     * @inheritdoc IGatingModule
     */
    function updateTokenContract(address newTokenContract) external override onlyOwner {
        tokenContract = newTokenContract;
        emit GatingConfigUpdated(GatingType.MERKLE_PROOF, newTokenContract, merkleRoot, block.timestamp);
    }

    // ============ Internal Functions ============

    function _verifyProof(
        bytes32[] memory proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;

        for (uint256 i = 0; i < proof.length; i++) {
            computedHash = _hashPair(computedHash, proof[i]);
        }

        return computedHash == root;
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }
}
