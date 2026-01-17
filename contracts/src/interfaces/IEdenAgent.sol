// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IEdenAgent
 * @notice Core interface for Eden AI agent contracts
 * @dev Defines the generalizable patterns for on-chain governance and content curation.
 *      All data content (messages, session details) is stored off-chain (IPFS).
 *      On-chain we only store hashes and essential state.
 *
 * Key Concepts:
 * - Session: Content unit submitted for curation (hash only on-chain)
 * - Reaction: Engagement signal (vote/blessing) on sessions
 * - Message: Community input on sessions (hash only on-chain)
 * - Edition: NFT copies minted for selected sessions (ERC1155)
 */
interface IEdenAgent {
    // ============ Enums ============

    enum SelectionMode {
        PERIOD_BASED,     // Sessions compete within discrete periods
        CONTINUOUS        // Sessions can be selected based on thresholds
    }

    enum TieBreaker {
        LOWEST_ID,        // Favor earliest submitted
        EARLIEST_TIME,    // Favor earliest timestamp
        RANDOM            // Use on-chain randomness
    }

    enum NoWinnerAction {
        REVERT,           // Transaction reverts
        SKIP              // Skip to next period
    }

    // ============ Core Structs ============

    /// @notice On-chain session state (content is in IPFS)
    struct Session {
        uint256 id;
        address creator;
        string contentHash;           // IPFS hash of session content
        uint256 reactionCount;
        uint256 reactionScore;        // Weighted score (quadratic + time decay)
        uint256 messageCount;
        uint256 createdAt;
        uint256 submittedInPeriod;
        uint256 selectedInPeriod;     // 0 if not selected
        bool isRetracted;
    }

    /// @notice On-chain message reference (content is in IPFS)
    struct MessageRef {
        uint256 id;
        uint256 sessionId;
        address sender;
        string contentHash;           // IPFS hash of message content
        uint256 createdAt;
    }

    /// @notice Agent configuration
    struct AgentConfig {
        uint256 periodDuration;           // Duration of each period (e.g., 1 day)
        uint256 reactionsPerToken;        // Reactions allowed per gating token per day
        uint256 messagesPerToken;         // Messages allowed per gating token per day
        uint256 reactionCost;             // ETH cost per reaction (0 = free)
        uint256 messageCost;              // ETH cost per message (0 = free)
        uint256 maxSessionsPerPeriod;     // Max sessions per period (0 = unlimited)
        uint256 maxTotalSessions;         // Max total sessions (0 = unlimited)
        SelectionMode selectionMode;
        TieBreaker tieBreaker;
        NoWinnerAction noWinnerAction;
        bool resetScoresOnPeriodEnd;      // Whether scores reset each period
    }

    /// @notice Edition configuration for NFT minting
    struct EditionConfig {
        uint256 totalEditions;            // Total editions per selected session (0 = 1-of-1)
        uint256 creatorEditions;          // Editions reserved for session creator
        uint256 curatorEditions;          // Editions for top reactors (curators)
        uint256 curatorCount;             // Number of top curators to reward
        uint256 publicEditions;           // Editions available for public sale
        uint256 publicPrice;              // Price per public edition
        uint256 creatorShareBps;          // Creator's share of sales (basis points)
        uint256 curatorShareBps;          // Curators' share of sales (basis points)
        uint256 treasuryShareBps;         // Treasury's share of sales (basis points)
    }

    /// @notice Scoring configuration
    struct ScoringConfig {
        uint256 reactionWeight;           // Weight for reactions (scaled by 1000)
        uint256 messageWeight;            // Weight for messages (scaled by 1000)
        uint256 timeDecayFactor;          // Time decay factor (1000 = no decay)
        uint256 quadraticScaling;         // 1 = quadratic, 0 = linear
    }

    // ============ Events ============

    event SessionSubmitted(
        uint256 indexed sessionId,
        address indexed creator,
        string contentHash,
        uint256 period,
        uint256 timestamp
    );

    event SessionRetracted(
        uint256 indexed sessionId,
        address indexed creator,
        uint256 timestamp
    );

    event ReactionSubmitted(
        uint256 indexed sessionId,
        address indexed reactor,
        address indexed actor,
        bool isDelegated,
        uint256 newScore,
        uint256 timestamp
    );

    event MessageSubmitted(
        uint256 indexed messageId,
        uint256 indexed sessionId,
        address indexed sender,
        string contentHash,
        uint256 timestamp
    );

    event SessionSelected(
        uint256 indexed period,
        uint256 indexed sessionId,
        uint256 reactionCount,
        uint256 score,
        uint256 timestamp
    );

    event EditionsMinted(
        uint256 indexed sessionId,
        uint256 indexed tokenId,
        uint256 totalMinted,
        uint256 timestamp
    );

    event EditionClaimed(
        uint256 indexed tokenId,
        address indexed claimer,
        uint256 amount,
        uint256 timestamp
    );

    event EditionPurchased(
        uint256 indexed tokenId,
        address indexed buyer,
        uint256 amount,
        uint256 price,
        uint256 timestamp
    );

    event PeriodStarted(
        uint256 indexed period,
        uint256 timestamp
    );

    event PeriodSkipped(
        uint256 indexed period,
        uint256 timestamp
    );

    event DelegateApproval(
        address indexed user,
        address indexed delegate,
        bool approved
    );

    event ConfigUpdated(
        string configType,
        uint256 timestamp
    );

    // ============ Session Functions ============

    function submitSession(string calldata contentHash) external returns (uint256 sessionId);

    function retractSession(uint256 sessionId) external;

    function getSession(uint256 sessionId) external view returns (Session memory);

    function getSessionCount() external view returns (uint256);

    // ============ Reaction Functions ============

    function react(
        uint256 sessionId,
        uint256[] calldata tokenIds,
        bytes calldata gatingProof
    ) external payable;

    function reactFor(
        uint256 sessionId,
        address reactor,
        uint256[] calldata tokenIds,
        bytes calldata gatingProof
    ) external payable;

    function getReactionCount(address user, uint256 sessionId) external view returns (uint256);

    function getRemainingReactions(address user, uint256 tokenCount) external view returns (uint256);

    // ============ Message Functions ============

    function sendMessage(
        uint256 sessionId,
        string calldata contentHash,
        uint256[] calldata tokenIds,
        bytes calldata gatingProof
    ) external payable;

    function getMessage(uint256 messageId) external view returns (MessageRef memory);

    function getSessionMessageCount(uint256 sessionId) external view returns (uint256);

    // ============ Selection Functions ============

    function selectSession() external returns (uint256 sessionId);

    function canSelect() external view returns (bool);

    function getTimeUntilPeriodEnd() external view returns (uint256);

    function getCurrentPeriod() external view returns (uint256);

    // ============ Edition Functions ============

    function claimCuratorEdition(uint256 tokenId) external;

    function purchaseEdition(uint256 tokenId, uint256 amount) external payable;

    function getEditionInfo(uint256 tokenId) external view returns (
        uint256 sessionId,
        uint256 totalSupply,
        uint256 maxSupply,
        uint256 availablePublic,
        uint256 price
    );

    // ============ Delegation ============

    function approveDelegate(address delegate, bool approved) external;

    function isDelegate(address user, address delegate) external view returns (bool);

    // ============ Configuration ============

    function getAgentConfig() external view returns (AgentConfig memory);

    function getEditionConfig() external view returns (EditionConfig memory);

    function getScoringConfig() external view returns (ScoringConfig memory);
}
