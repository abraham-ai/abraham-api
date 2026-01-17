// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "../../interfaces/IGatingModule.sol";

/**
 * @title MerkleGating
 * @notice Gating module using Merkle proofs for off-chain ownership snapshots
 * @dev Allows verification of token ownership via Merkle proofs generated
 *      from off-chain snapshots. This is gas-efficient for large token sets
 *      and supports any external NFT collection.
 *
 *      Proof structure:
 *      - Leaf: keccak256(abi.encode(user, tokenIds))
 *      - Root: Updated periodically by admin
 */
contract MerkleGating is IGatingModule, Ownable {
    bytes32 public merkleRoot;
    uint256 public rootTimestamp;
    uint256 public rootBlockNumber;

    event RootUpdated(bytes32 indexed newRoot, uint256 timestamp, uint256 blockNumber);

    error InvalidRoot();
    error RootNotSet();

    constructor(address admin) Ownable(admin) {}

    /// @notice Update the Merkle root
    /// @param newRoot The new Merkle root
    function updateRoot(bytes32 newRoot) external onlyOwner {
        if (newRoot == bytes32(0)) revert InvalidRoot();
        merkleRoot = newRoot;
        rootTimestamp = block.timestamp;
        rootBlockNumber = block.number;
        emit RootUpdated(newRoot, block.timestamp, block.number);
    }

    /// @inheritdoc IGatingModule
    function verify(
        address user,
        uint256[] calldata tokenIds,
        bytes calldata proof
    ) external view returns (GatingResult memory result) {
        if (merkleRoot == bytes32(0)) {
            return GatingResult({
                valid: false,
                tokenCount: 0,
                reason: "Root not set"
            });
        }

        if (tokenIds.length == 0) {
            return GatingResult({
                valid: false,
                tokenCount: 0,
                reason: "No tokens provided"
            });
        }

        // Check for duplicate token IDs
        for (uint256 i = 0; i < tokenIds.length; i++) {
            for (uint256 j = i + 1; j < tokenIds.length; j++) {
                if (tokenIds[i] == tokenIds[j]) {
                    return GatingResult({
                        valid: false,
                        tokenCount: 0,
                        reason: "Duplicate token IDs"
                    });
                }
            }
        }

        // Decode proof as bytes32[]
        bytes32[] memory merkleProof = abi.decode(proof, (bytes32[]));

        // Compute leaf
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(user, tokenIds))));

        // Verify proof
        bool valid = MerkleProof.verify(merkleProof, merkleRoot, leaf);

        if (!valid) {
            return GatingResult({
                valid: false,
                tokenCount: 0,
                reason: "Invalid proof"
            });
        }

        return GatingResult({
            valid: true,
            tokenCount: tokenIds.length,
            reason: ""
        });
    }

    /// @inheritdoc IGatingModule
    function getGatingType() external pure returns (string memory) {
        return "merkle";
    }

    /// @inheritdoc IGatingModule
    function requiresProof() external pure returns (bool) {
        return true;
    }

    /// @notice Get root info
    function getRootInfo() external view returns (
        bytes32 root,
        uint256 timestamp,
        uint256 blockNum
    ) {
        return (merkleRoot, rootTimestamp, rootBlockNumber);
    }
}
