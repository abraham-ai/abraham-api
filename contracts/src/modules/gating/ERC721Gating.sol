// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "../../interfaces/IGatingModule.sol";

/**
 * @title ERC721Gating
 * @notice Gating module using on-chain ERC721 ownership verification
 * @dev Verifies token ownership directly on-chain. More gas intensive than
 *      Merkle proofs but doesn't require off-chain snapshots.
 *
 *      Supports multiple NFT collections with configurable weight per collection.
 */
contract ERC721Gating is IGatingModule, Ownable {
    struct Collection {
        IERC721 token;
        uint256 weight;    // Weight per token (1 = 1 vote, 2 = 2 votes per token)
        bool enabled;
    }

    mapping(address => Collection) public collections;
    address[] public collectionAddresses;

    event CollectionAdded(address indexed token, uint256 weight);
    event CollectionRemoved(address indexed token);
    event CollectionWeightUpdated(address indexed token, uint256 newWeight);

    error CollectionNotFound();
    error CollectionAlreadyExists();
    error InvalidWeight();

    constructor(address admin) Ownable(admin) {}

    /// @notice Add a collection for gating
    /// @param token The ERC721 token address
    /// @param weight Weight per token owned
    function addCollection(address token, uint256 weight) external onlyOwner {
        if (weight == 0) revert InvalidWeight();
        if (collections[token].enabled) revert CollectionAlreadyExists();

        collections[token] = Collection({
            token: IERC721(token),
            weight: weight,
            enabled: true
        });
        collectionAddresses.push(token);

        emit CollectionAdded(token, weight);
    }

    /// @notice Remove a collection
    /// @param token The ERC721 token address
    function removeCollection(address token) external onlyOwner {
        if (!collections[token].enabled) revert CollectionNotFound();

        collections[token].enabled = false;

        // Remove from array
        for (uint256 i = 0; i < collectionAddresses.length; i++) {
            if (collectionAddresses[i] == token) {
                collectionAddresses[i] = collectionAddresses[collectionAddresses.length - 1];
                collectionAddresses.pop();
                break;
            }
        }

        emit CollectionRemoved(token);
    }

    /// @notice Update collection weight
    /// @param token The ERC721 token address
    /// @param newWeight New weight per token
    function updateWeight(address token, uint256 newWeight) external onlyOwner {
        if (!collections[token].enabled) revert CollectionNotFound();
        if (newWeight == 0) revert InvalidWeight();

        collections[token].weight = newWeight;

        emit CollectionWeightUpdated(token, newWeight);
    }

    /// @inheritdoc IGatingModule
    function verify(
        address user,
        uint256[] calldata tokenIds,
        bytes calldata proof
    ) external view returns (GatingResult memory result) {
        if (collectionAddresses.length == 0) {
            return GatingResult({
                valid: false,
                tokenCount: 0,
                reason: "No collections configured"
            });
        }

        // Decode proof to get which collection to check
        // Format: abi.encode(collectionAddress)
        address collectionAddr;
        if (proof.length > 0) {
            collectionAddr = abi.decode(proof, (address));
        } else {
            // Default to first collection
            collectionAddr = collectionAddresses[0];
        }

        Collection storage col = collections[collectionAddr];
        if (!col.enabled) {
            return GatingResult({
                valid: false,
                tokenCount: 0,
                reason: "Collection not enabled"
            });
        }

        // If no specific token IDs provided, check balance
        if (tokenIds.length == 0) {
            uint256 balance = col.token.balanceOf(user);
            if (balance == 0) {
                return GatingResult({
                    valid: false,
                    tokenCount: 0,
                    reason: "No tokens owned"
                });
            }
            return GatingResult({
                valid: true,
                tokenCount: balance * col.weight,
                reason: ""
            });
        }

        // Verify ownership of specific token IDs
        uint256 validCount = 0;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            try col.token.ownerOf(tokenIds[i]) returns (address owner) {
                if (owner == user) {
                    validCount++;
                }
            } catch {
                // Token doesn't exist or other error
                continue;
            }
        }

        if (validCount == 0) {
            return GatingResult({
                valid: false,
                tokenCount: 0,
                reason: "No valid tokens owned"
            });
        }

        return GatingResult({
            valid: true,
            tokenCount: validCount * col.weight,
            reason: ""
        });
    }

    /// @inheritdoc IGatingModule
    function getGatingType() external pure returns (string memory) {
        return "erc721";
    }

    /// @inheritdoc IGatingModule
    function requiresProof() external pure returns (bool) {
        return false; // Collection address is optional
    }

    /// @notice Get all enabled collections
    function getCollections() external view returns (address[] memory) {
        return collectionAddresses;
    }

    /// @notice Get collection info
    function getCollectionInfo(address token) external view returns (
        uint256 weight,
        bool enabled
    ) {
        Collection storage col = collections[token];
        return (col.weight, col.enabled);
    }
}
