// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "../../interfaces/IGatingModule.sol";

/**
 * @title ERC721Gating
 * @notice On-chain ERC721 ownership verification module
 * @dev This module verifies ownership by checking on-chain ERC721 balances.
 *      Useful when:
 *      - You want real-time ownership verification
 *      - The gating token is on the same chain
 *      - You don't need snapshot-based voting
 *
 * Note: This approach doesn't prevent double-voting after transfers within
 * the same period. For snapshot-based voting, use MerkleGating instead.
 */
contract ERC721Gating is IGatingModule, Ownable {

    IERC721 public token;
    uint256 public minBalance;

    event TokenContractUpdated(address indexed previousToken, address indexed newToken);
    event MinBalanceUpdated(uint256 previousBalance, uint256 newBalance);

    error InvalidTokenContract();
    error TokenNotOwned();

    constructor(address admin_, address tokenContract_, uint256 minBalance_) Ownable(admin_) {
        if (tokenContract_ == address(0)) revert InvalidTokenContract();
        token = IERC721(tokenContract_);
        minBalance = minBalance_;
    }

    // ============ IGatingModule Implementation ============

    /**
     * @inheritdoc IGatingModule
     */
    function verify(
        address user,
        uint256[] calldata tokenIds,
        bytes calldata /* proof - not used for on-chain verification */
    ) external view override returns (VerificationResult memory result) {
        // If no specific token IDs provided, just check balance
        if (tokenIds.length == 0) {
            uint256 balance = token.balanceOf(user);
            if (balance < minBalance) {
                return VerificationResult({
                    valid: false,
                    tokenCount: balance,
                    errorReason: "Insufficient token balance"
                });
            }
            return VerificationResult({
                valid: true,
                tokenCount: balance,
                errorReason: ""
            });
        }

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

        // Verify ownership of each token ID
        for (uint256 i = 0; i < tokenIds.length; i++) {
            try token.ownerOf(tokenIds[i]) returns (address owner) {
                if (owner != user) {
                    return VerificationResult({
                        valid: false,
                        tokenCount: 0,
                        errorReason: "Token not owned by user"
                    });
                }
            } catch {
                return VerificationResult({
                    valid: false,
                    tokenCount: 0,
                    errorReason: "Token does not exist"
                });
            }
        }

        return VerificationResult({
            valid: true,
            tokenCount: tokenIds.length,
            errorReason: ""
        });
    }

    /**
     * @inheritdoc IGatingModule
     */
    function getTokenCount(address user) external view override returns (uint256) {
        return token.balanceOf(user);
    }

    /**
     * @inheritdoc IGatingModule
     */
    function getGatingType() external pure override returns (GatingType) {
        return GatingType.ERC721_BALANCE;
    }

    /**
     * @inheritdoc IGatingModule
     */
    function getTokenContract() external view override returns (address) {
        return address(token);
    }

    // ============ Admin Functions ============

    /**
     * @inheritdoc IGatingModule
     */
    function updateRoot(bytes32 /* newRoot */) external pure override {
        // Not applicable for ERC721 balance gating
        revert("Not supported");
    }

    /**
     * @inheritdoc IGatingModule
     */
    function updateTokenContract(address newTokenContract) external override onlyOwner {
        if (newTokenContract == address(0)) revert InvalidTokenContract();

        address previousToken = address(token);
        token = IERC721(newTokenContract);

        emit TokenContractUpdated(previousToken, newTokenContract);
        emit GatingConfigUpdated(GatingType.ERC721_BALANCE, newTokenContract, bytes32(0), block.timestamp);
    }

    /**
     * @notice Update minimum balance requirement
     */
    function updateMinBalance(uint256 newMinBalance) external onlyOwner {
        uint256 previousBalance = minBalance;
        minBalance = newMinBalance;
        emit MinBalanceUpdated(previousBalance, newMinBalance);
    }
}
