// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title IEdenAgentProtocol
 * @notice Core interface defining the generalizable patterns for Eden agent contracts
 * @dev This protocol enables any AI agent to have on-chain governance, content curation,
 *      and community engagement. Agents can adopt this directly or extend it with custom logic.
 *
 * Key Concepts (aligned with MongoDB schemas):
 * - Session: On-chain content unit (maps to off-chain Session document)
 * - Message: Reactions/comments on sessions (maps to Message document)
 * - Creation: NFT outputs from selected sessions (maps to Creation document)
 *
 * Generalizable Patterns:
 * - Pluggable gating (Merkle proofs, signatures, token balances, custom)
 * - Pluggable scoring (quadratic, linear, time-weighted, custom)
 * - Configurable periods (round-based or continuous)
 * - NFT flexibility (ERC721 or ERC1155)
 * - Role-based access (admin, relayer, creator)
 */
interface IEdenAgentProtocol {

    // ============ Enums ============

    /// @notice Operating mode for content selection
    enum SelectionMode {
        ROUND_BASED,      // Sessions compete within discrete rounds
        CONTINUOUS        // Sessions can be selected at any time based on thresholds
    }

    /// @notice Strategy for breaking ties between equally-scored sessions
    enum TieBreakingStrategy {
        LOWEST_ID,        // Favor the earliest submitted (lowest ID)
        EARLIEST_TIME,    // Favor earliest timestamp
        PSEUDO_RANDOM     // Use on-chain randomness
    }

    /// @notice Strategy when no valid winner exists
    enum NoWinnerStrategy {
        REVERT,           // Transaction reverts
        SKIP              // Skip to next period
    }

    /// @notice Type of NFT to mint for selected content
    enum NFTType {
        ERC721,           // Unique 1-of-1 tokens
        ERC1155           // Semi-fungible tokens (editions)
    }

    // ============ Core Structs ============

    /// @notice On-chain representation of a content session
    /// @dev Maps to the off-chain Session MongoDB document
    struct Session {
        uint256 id;
        address creator;              // Who submitted this session
        string contentHash;           // IPFS hash of session content
        uint256 reactionCount;        // Total reaction count
        uint256 messageCount;         // Total message count
        uint256 score;                // Calculated engagement score
        uint256 createdAt;
        bool isSelected;              // Whether this session was selected as a "winner"
        bool isRetracted;             // Whether creator retracted this
        uint256 selectedInPeriod;     // Which period this was selected in (0 if not selected)
        uint256 submittedInPeriod;    // Which period this was submitted in
    }

    /// @notice On-chain representation of a message within a session
    /// @dev Maps to the off-chain Message MongoDB document
    struct Message {
        uint256 id;
        uint256 sessionId;
        address sender;               // Who sent this message
        string contentHash;           // IPFS hash of message content
        string[] attachments;         // IPFS hashes of attachments (mirrors MongoDB schema)
        uint256 createdAt;
    }

    /// @notice Configuration for the agent protocol
    struct AgentConfig {
        uint256 periodDuration;       // Duration of each period (e.g., 1 day)
        uint256 reactionsPerToken;    // Reactions allowed per gating token per period
        uint256 messagesPerToken;     // Messages allowed per gating token per period
        uint256 reactionCost;         // ETH cost per reaction (0 = free)
        uint256 messageCost;          // ETH cost per message (0 = free)
        uint256 maxSessionsPerPeriod; // Max sessions allowed per period
        uint256 maxTotalSessions;     // Max total sessions ever
        SelectionMode selectionMode;
        TieBreakingStrategy tieStrategy;
        NoWinnerStrategy noWinnerStrategy;
        NFTType nftType;
        bool resetScoresOnPeriodEnd;  // Whether scores reset each period
    }

    /// @notice Scoring configuration for engagement calculations
    struct ScoringConfig {
        uint256 reactionWeight;       // Weight for reactions (scaled by 1000)
        uint256 messageWeight;        // Weight for comments (scaled by 1000)
        uint256 timeDecayMin;         // Minimum time decay factor
        uint256 timeDecayBase;        // Base for time decay calculation
        uint256 scaleFactor;          // Scale factor for precision (e.g., 1e6)
    }

    // ============ Events ============

    event SessionSubmitted(
        uint256 indexed sessionId,
        address indexed creator,
        string contentHash,
        uint256 timestamp
    );

    event SessionRetracted(
        uint256 indexed sessionId,
        address indexed creator
    );

    event ReactionSubmitted(
        uint256 indexed sessionId,
        address indexed reactor,
        address indexed actor,      // Who submitted (may be delegate/relayer)
        bool isDelegated,
        uint256 timestamp
    );

    event MessageSubmitted(
        uint256 indexed messageId,
        uint256 indexed sessionId,
        address indexed sender,
        address actor,
        bool isDelegated,
        string contentHash,
        uint256 timestamp
    );

    event SessionSelected(
        uint256 indexed period,
        uint256 indexed sessionId,
        string contentHash,
        uint256 reactionCount,
        uint256 score
    );

    event PeriodStarted(
        uint256 indexed period,
        uint256 startTime
    );

    event PeriodSkipped(
        uint256 indexed period,
        uint256 timestamp
    );

    event ScoreUpdated(
        uint256 indexed sessionId,
        address indexed reactor,
        uint256 previousScore,
        uint256 newScore
    );

    event NFTMinted(
        uint256 indexed tokenId,
        uint256 indexed sessionId,
        address indexed creator,
        uint256 period
    );

    event DelegateApproval(
        address indexed user,
        address indexed delegate,
        bool approved
    );

    event ConfigUpdated(
        string configType,
        uint256 previousValue,
        uint256 newValue
    );

    event GatingRootUpdated(
        bytes32 indexed newRoot,
        uint256 timestamp,
        uint256 blockNumber
    );

    // ============ Core Functions ============

    /// @notice Submit a new session for consideration
    /// @param contentHash IPFS hash of the session content
    /// @return sessionId The ID of the newly created session
    function submitSession(string calldata contentHash) external returns (uint256 sessionId);

    /// @notice Retract a previously submitted session
    /// @param sessionId The ID of the session to retract
    function retractSession(uint256 sessionId) external;

    /// @notice React to a session (requires valid gating proof)
    /// @param sessionId The session to react to
    /// @param tokenIds Token IDs owned by reactor (for gating)
    /// @param proof Merkle proof or other verification data
    function react(
        uint256 sessionId,
        uint256[] calldata tokenIds,
        bytes32[] calldata proof
    ) external payable;

    /// @notice React on behalf of another user (delegate or relayer)
    /// @param sessionId The session to react to
    /// @param reactor The user whose reaction this represents
    /// @param tokenIds Token IDs owned by reactor
    /// @param proof Verification proof
    function reactFor(
        uint256 sessionId,
        address reactor,
        uint256[] calldata tokenIds,
        bytes32[] calldata proof
    ) external payable;

    /// @notice Send a message to a session (requires valid gating proof)
    /// @param sessionId The session to send message to
    /// @param contentHash IPFS hash of the message content
    /// @param attachments IPFS hashes of any attachments
    /// @param tokenIds Token IDs owned by sender
    /// @param proof Verification proof
    function sendMessage(
        uint256 sessionId,
        string calldata contentHash,
        string[] calldata attachments,
        uint256[] calldata tokenIds,
        bytes32[] calldata proof
    ) external payable;

    /// @notice Select the winning session for the current period
    /// @return sessionId The ID of the selected session (0 if skipped)
    function selectSession() external returns (uint256 sessionId);

    /// @notice Approve or revoke a delegate for your account
    /// @param delegate The address to approve/revoke
    /// @param approved Whether to approve or revoke
    function approveDelegate(address delegate, bool approved) external;

    // ============ View Functions ============

    /// @notice Get a session by ID
    function getSession(uint256 sessionId) external view returns (Session memory);

    /// @notice Get remaining time until current period ends
    function getTimeUntilPeriodEnd() external view returns (uint256);

    /// @notice Get remaining reactions for a user in current period
    function getRemainingReactions(address user, uint256 tokenCount) external view returns (uint256);

    /// @notice Get remaining messages for a user in current period
    function getRemainingMessages(address user, uint256 tokenCount) external view returns (uint256);

    /// @notice Check if a user can react today
    function canReactToday(address user, uint256 tokenCount) external view returns (bool);

    /// @notice Get the current period number
    function getCurrentPeriod() external view returns (uint256);

    /// @notice Get the agent configuration
    function getConfig() external view returns (AgentConfig memory);

    /// @notice Get the scoring configuration
    function getScoringConfig() external view returns (ScoringConfig memory);
}
