// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title ICurationModule
 * @notice Interface for pluggable curation mechanisms in Eden agents
 * @dev Curation modules determine how contributors are rewarded for their participation.
 *      Different modules enable different economic models:
 *
 *      - SIMPLE: No shares, just voting/reactions (current default)
 *      - CONTRIBUTION_SHARES: ERC1155 shares minted on contribution
 *      - BONDING_CURVE: Buy/sell shares with price discovery
 *      - STAKING_REWARDS: Stake tokens to earn from winners
 *
 * Integration:
 *      The core contract calls curation hooks (onReaction, onMessage, onSessionSelected)
 *      and the module handles share distribution, rewards, etc.
 */
interface ICurationModule {
    // ============ Enums ============

    enum CurationType {
        SIMPLE,              // No shares - traditional voting
        CONTRIBUTION_SHARES, // ERC1155 shares on contribution (time-weighted)
        BONDING_CURVE,       // Continuous buy/sell with bonding curve
        STAKING_REWARDS,     // Stake to earn from winners
        CUSTOM               // Custom implementation
    }

    // ============ Structs ============

    /// @notice Configuration for curation economics
    struct CurationConfig {
        uint256 creatorShareBps;        // Creator's share of rewards (basis points, e.g., 1000 = 10%)
        uint256 protocolFeeBps;         // Protocol fee (basis points)
        uint256 earlyContributorBonus;  // Multiplier for early contributors (scaled by 1000)
        uint256 reactionShareAmount;    // Shares per reaction (for CONTRIBUTION_SHARES)
        uint256 messageShareAmount;     // Shares per message (for CONTRIBUTION_SHARES)
        uint256 bondingCurveSlope;      // Slope for bonding curve (for BONDING_CURVE)
        uint256 bondingCurveIntercept;  // Initial price (for BONDING_CURVE)
        uint256 minStakeAmount;         // Minimum stake (for STAKING_REWARDS)
        bool enableSecondaryTrading;    // Allow share transfers/sales
    }

    /// @notice Session curation state
    struct SessionCurationState {
        uint256 totalShares;            // Total shares issued for this session
        uint256 totalStaked;            // Total amount staked (for staking model)
        uint256 rewardPool;             // Accumulated rewards
        uint256 lastPricePerShare;      // Last trading price (for bonding curve)
        bool isFinalized;               // Whether rewards have been distributed
    }

    // ============ Events ============

    event SharesMinted(
        uint256 indexed sessionId,
        address indexed recipient,
        uint256 amount,
        uint256 timestamp
    );

    event SharesBurned(
        uint256 indexed sessionId,
        address indexed holder,
        uint256 amount,
        uint256 timestamp
    );

    event SharesTransferred(
        uint256 indexed sessionId,
        address indexed from,
        address indexed to,
        uint256 amount
    );

    event SharesPurchased(
        uint256 indexed sessionId,
        address indexed buyer,
        uint256 shareAmount,
        uint256 ethPaid,
        uint256 newPrice
    );

    event SharesSold(
        uint256 indexed sessionId,
        address indexed seller,
        uint256 shareAmount,
        uint256 ethReceived,
        uint256 newPrice
    );

    event Staked(
        uint256 indexed sessionId,
        address indexed staker,
        uint256 amount
    );

    event Unstaked(
        uint256 indexed sessionId,
        address indexed staker,
        uint256 amount
    );

    event RewardsDistributed(
        uint256 indexed sessionId,
        uint256 totalRewards,
        uint256 creatorAmount,
        uint256 contributorAmount
    );

    event RewardsClaimed(
        uint256 indexed sessionId,
        address indexed claimer,
        uint256 amount
    );

    event CurationConfigUpdated(
        CurationType indexed curationType,
        uint256 timestamp
    );

    // ============ Core Hooks ============

    /**
     * @notice Called when a user reacts to a session
     * @dev Module should mint shares, update stakes, etc.
     * @param sessionId The session being reacted to
     * @param reactor The user reacting
     * @param reactionCount Number of reactions in this action
     * @param ethPaid ETH paid for the reaction
     */
    function onReaction(
        uint256 sessionId,
        address reactor,
        uint256 reactionCount,
        uint256 ethPaid
    ) external;

    /**
     * @notice Called when a user sends a message to a session
     * @param sessionId The session receiving the message
     * @param sender The message sender
     * @param ethPaid ETH paid for the message
     */
    function onMessage(
        uint256 sessionId,
        address sender,
        uint256 ethPaid
    ) external;

    /**
     * @notice Called when a session is selected as winner
     * @dev Module should finalize rewards, enable claims, etc.
     * @param sessionId The winning session
     * @param period The period in which it won
     */
    function onSessionSelected(
        uint256 sessionId,
        uint256 period
    ) external;

    /**
     * @notice Called when a new session is created
     * @param sessionId The new session ID
     * @param creator The session creator
     */
    function onSessionCreated(
        uint256 sessionId,
        address creator
    ) external;

    // ============ Trading Functions (for BONDING_CURVE) ============

    /**
     * @notice Buy shares in a session
     * @param sessionId The session to buy shares in
     * @param minShares Minimum shares to receive (slippage protection)
     * @return sharesBought Number of shares purchased
     */
    function buyShares(
        uint256 sessionId,
        uint256 minShares
    ) external payable returns (uint256 sharesBought);

    /**
     * @notice Sell shares in a session
     * @param sessionId The session to sell shares from
     * @param shareAmount Number of shares to sell
     * @param minEth Minimum ETH to receive (slippage protection)
     * @return ethReceived Amount of ETH received
     */
    function sellShares(
        uint256 sessionId,
        uint256 shareAmount,
        uint256 minEth
    ) external returns (uint256 ethReceived);

    /**
     * @notice Get current price per share for a session
     * @param sessionId The session ID
     * @return price Current price in wei
     */
    function getCurrentPrice(uint256 sessionId) external view returns (uint256 price);

    /**
     * @notice Get price for buying a specific amount of shares
     * @param sessionId The session ID
     * @param shareAmount Number of shares to buy
     * @return cost Total cost in wei
     */
    function getBuyPrice(uint256 sessionId, uint256 shareAmount) external view returns (uint256 cost);

    /**
     * @notice Get proceeds from selling a specific amount of shares
     * @param sessionId The session ID
     * @param shareAmount Number of shares to sell
     * @return proceeds Amount of ETH received
     */
    function getSellPrice(uint256 sessionId, uint256 shareAmount) external view returns (uint256 proceeds);

    // ============ Staking Functions (for STAKING_REWARDS) ============

    /**
     * @notice Stake ETH/tokens on a session
     * @param sessionId The session to stake on
     */
    function stake(uint256 sessionId) external payable;

    /**
     * @notice Unstake from a session (may have penalties)
     * @param sessionId The session to unstake from
     * @param amount Amount to unstake
     */
    function unstake(uint256 sessionId, uint256 amount) external;

    /**
     * @notice Get user's staked amount
     * @param sessionId The session ID
     * @param user The user address
     * @return amount Staked amount
     */
    function getStakedAmount(uint256 sessionId, address user) external view returns (uint256 amount);

    // ============ Rewards Functions ============

    /**
     * @notice Claim accumulated rewards
     * @param sessionId The session to claim from
     * @return amount Amount claimed
     */
    function claimRewards(uint256 sessionId) external returns (uint256 amount);

    /**
     * @notice Get claimable rewards for a user
     * @param sessionId The session ID
     * @param user The user address
     * @return amount Claimable amount
     */
    function getClaimableRewards(uint256 sessionId, address user) external view returns (uint256 amount);

    // ============ View Functions ============

    /**
     * @notice Get user's shares in a session
     * @param sessionId The session ID
     * @param user The user address
     * @return shares Number of shares owned
     */
    function getShares(uint256 sessionId, address user) external view returns (uint256 shares);

    /**
     * @notice Get total shares for a session
     * @param sessionId The session ID
     * @return totalShares Total shares issued
     */
    function getTotalShares(uint256 sessionId) external view returns (uint256 totalShares);

    /**
     * @notice Get session curation state
     * @param sessionId The session ID
     * @return state The curation state
     */
    function getSessionState(uint256 sessionId) external view returns (SessionCurationState memory state);

    /**
     * @notice Get the curation type of this module
     * @return curationType The type of curation
     */
    function getCurationType() external view returns (CurationType curationType);

    /**
     * @notice Get the curation configuration
     * @return config The curation config
     */
    function getCurationConfig() external view returns (CurationConfig memory config);

    /**
     * @notice Get the ERC1155 token contract (if applicable)
     * @return tokenContract Address of the share token contract
     */
    function getShareTokenContract() external view returns (address tokenContract);
}
