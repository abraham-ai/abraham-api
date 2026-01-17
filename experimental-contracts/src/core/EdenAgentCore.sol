// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

import "../interfaces/IEdenAgentProtocol.sol";
import "../interfaces/IGatingModule.sol";
import "../interfaces/IScoringModule.sol";
import "../interfaces/ICurationModule.sol";

/**
 * @title EdenAgentCore
 * @notice Core contract for Eden AI agent on-chain governance and content curation
 * @dev This contract can be deployed directly for simple agents, or extended for
 *      agents with custom terminology/logic (like AbrahamSeeds).
 *
 * Deployment Options:
 * 1. Deploy directly via EdenAgentFactory.createAgent(config)
 * 2. Extend with custom contract and deploy independently
 * 3. Register custom implementation with factory for cloning
 *
 * Key Features:
 * - Pluggable gating (Merkle proofs, token balances, signatures)
 * - Pluggable scoring (quadratic, linear, time-weighted)
 * - Session submission and curation
 * - Reaction and message systems with rate limiting
 * - Period-based or continuous selection modes
 * - NFT minting for selected content (ERC721 or ERC1155)
 * - Role-based access control
 * - Delegated actions
 * - Deferred configuration updates
 *
 * MongoDB Schema Alignment:
 * - Session struct ↔ Session document
 * - Message struct ↔ Message document
 * - NFT minting ↔ Creation document
 */
contract EdenAgentCore is
    IEdenAgentProtocol,
    AccessControl,
    ReentrancyGuard,
    ERC721,
    ERC721Holder,
    ERC1155Holder
{
    // ============ Constants ============

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");

    uint256 public constant MAX_SESSIONS_PER_PERIOD = 1000;
    uint256 public constant MAX_TOTAL_SESSIONS = 100000;
    uint256 public constant SCORE_SCALE_FACTOR = 1e6;

    // ============ State Variables ============

    // Core state
    bool public paused;
    uint256 public sessionCount;
    uint256 public currentPeriod;
    uint256 public currentPeriodStart;
    uint256 public totalReactions;
    uint256 public totalMessages;

    // Configuration (current)
    AgentConfig public config;
    ScoringConfig public scoringConfig;

    // Configuration (pending - applied at period boundaries)
    AgentConfig private _pendingConfig;
    ScoringConfig private _pendingScoringConfig;
    bool public hasPendingConfigUpdate;
    bool public hasPendingScoringUpdate;

    // Treasury
    address public treasury;

    // Gating
    IGatingModule public gatingModule;
    bytes32 public gatingRoot; // For Merkle-based gating (legacy compatibility)
    uint256 public rootTimestamp;

    // Curation (optional - if not set, no curation market mechanics)
    ICurationModule public curationModule;

    // Session storage
    mapping(uint256 => Session) public sessions;
    uint256[] public allSessionIds;
    uint256[] public eligibleSessionIds;
    mapping(uint256 => uint256) private _eligibleSessionIndex;
    mapping(uint256 => bool) private _isInEligibleArray;

    // Period tracking
    mapping(uint256 => uint256) public periodWinners;
    mapping(uint256 => uint256[]) public periodSessionIds;

    // Scoring
    mapping(uint256 => uint256) public sessionScore;
    mapping(uint256 => mapping(uint256 => uint256)) public sessionScoreByPeriod;

    // User tracking
    mapping(address => mapping(address => bool)) public isDelegateApproved;
    mapping(address => mapping(uint256 => uint256)) public userDailyReactions;
    mapping(address => mapping(uint256 => uint256)) public userDailyMessages;
    mapping(address => mapping(uint256 => uint256)) public userSessionReactionCount;
    mapping(uint256 => mapping(address => mapping(uint256 => uint256))) public userSessionReactionsByPeriod;

    // Message storage
    mapping(uint256 => Message) public messages;
    mapping(uint256 => uint256[]) public sessionMessageIds;
    uint256 public messageIdCounter;

    // NFT storage
    uint256 private _nextTokenId;
    mapping(uint256 => uint256) public tokenIdToSessionId;
    mapping(uint256 => uint256) public sessionIdToTokenId;
    string private _baseTokenURI;

    // ============ Errors ============

    error ContractPaused();
    error SessionNotFound();
    error SessionAlreadySelected();
    error SessionRetracted();
    error PeriodNotEnded();
    error PeriodEnded();
    error NoValidWinner();
    error InvalidSessionData();
    error NotSessionCreator();
    error CannotRetractSelectedSession();
    error InvalidGatingProof();
    error NoVotingPower();
    error NotAuthorized();
    error InvalidAddress();
    error DailyReactionLimitReached();
    error DailyMessageLimitReached();
    error InvalidPeriodDuration();
    error InvalidReactionsPerToken();
    error MaxSessionsReached();
    error PeriodSessionLimitReached();
    error AlreadyRetracted();
    error InvalidContentHash();
    error InsufficientPayment();
    error InvalidTreasury();
    error NoFeesToWithdraw();
    error TreasuryNotSet();
    error TransferFailed();

    // ============ Modifiers ============

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    // ============ Constructor ============

    constructor(
        string memory name_,
        string memory symbol_,
        address admin_,
        address treasury_,
        AgentConfig memory initialConfig_,
        ScoringConfig memory initialScoringConfig_
    ) ERC721(name_, symbol_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ADMIN_ROLE, admin_);

        treasury = treasury_;
        config = initialConfig_;
        scoringConfig = initialScoringConfig_;

        currentPeriodStart = block.timestamp;
        currentPeriod = 1;
        _nextTokenId = 1;

        emit PeriodStarted(1, block.timestamp);
    }

    // ============ Session Management ============

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function submitSession(string calldata contentHash)
        external
        virtual
        whenNotPaused
        onlyRole(CREATOR_ROLE)
        returns (uint256 sessionId)
    {
        _validateContentHash(contentHash);

        if (sessionCount >= config.maxTotalSessions) revert MaxSessionsReached();
        if (periodSessionIds[currentPeriod].length >= config.maxSessionsPerPeriod) {
            revert PeriodSessionLimitReached();
        }

        sessionId = sessionCount++;

        sessions[sessionId] = Session({
            id: sessionId,
            creator: msg.sender,
            contentHash: contentHash,
            reactionCount: 0,
            messageCount: 0,
            score: 0,
            createdAt: block.timestamp,
            isSelected: false,
            isRetracted: false,
            selectedInPeriod: 0,
            submittedInPeriod: currentPeriod
        });

        periodSessionIds[currentPeriod].push(sessionId);
        allSessionIds.push(sessionId);
        eligibleSessionIds.push(sessionId);
        _eligibleSessionIndex[sessionId] = eligibleSessionIds.length - 1;
        _isInEligibleArray[sessionId] = true;

        // Notify curation module if set
        if (address(curationModule) != address(0)) {
            curationModule.onSessionCreated(sessionId, msg.sender);
        }

        emit SessionSubmitted(sessionId, msg.sender, contentHash, block.timestamp);
    }

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function retractSession(uint256 sessionId) external virtual {
        Session storage session = sessions[sessionId];

        if (session.createdAt == 0) revert SessionNotFound();
        if (session.creator != msg.sender) revert NotSessionCreator();
        if (session.isSelected) revert CannotRetractSelectedSession();
        if (session.isRetracted) revert AlreadyRetracted();

        session.isRetracted = true;
        _removeFromEligibleSessions(sessionId);

        emit SessionRetracted(sessionId, msg.sender);
    }

    // ============ Reactions ============

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function react(
        uint256 sessionId,
        uint256[] calldata tokenIds,
        bytes32[] calldata proof
    ) external payable virtual whenNotPaused nonReentrant {
        if (msg.value < config.reactionCost) revert InsufficientPayment();

        if (!_verifyGating(msg.sender, tokenIds, proof)) revert InvalidGatingProof();
        if (tokenIds.length == 0) revert NoVotingPower();

        _checkAndUpdateDailyReactionLimit(msg.sender, tokenIds.length);
        _processReaction(sessionId, msg.sender, msg.sender, false);

        _refundExcess(config.reactionCost);
    }

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function reactFor(
        uint256 sessionId,
        address reactor,
        uint256[] calldata tokenIds,
        bytes32[] calldata proof
    ) external payable virtual whenNotPaused nonReentrant {
        if (reactor == address(0)) revert InvalidAddress();
        if (msg.value < config.reactionCost) revert InsufficientPayment();

        bool isApprovedDelegate = isDelegateApproved[reactor][msg.sender];
        bool isRelayer = hasRole(RELAYER_ROLE, msg.sender);

        if (!isApprovedDelegate && !isRelayer) revert NotAuthorized();
        if (!_verifyGating(reactor, tokenIds, proof)) revert InvalidGatingProof();
        if (tokenIds.length == 0) revert NoVotingPower();

        _checkAndUpdateDailyReactionLimit(reactor, tokenIds.length);
        _processReaction(sessionId, reactor, msg.sender, true);

        _refundExcess(config.reactionCost);
    }

    /**
     * @notice Batch react on behalf of multiple users (relayer only)
     */
    function batchReactFor(
        uint256[] calldata sessionIds,
        address[] calldata reactors,
        uint256[][] calldata tokenIdsArray,
        bytes32[][] calldata proofs
    ) external virtual whenNotPaused nonReentrant onlyRole(RELAYER_ROLE) {
        if (sessionIds.length != reactors.length ||
            sessionIds.length != tokenIdsArray.length ||
            sessionIds.length != proofs.length ||
            sessionIds.length == 0) {
            revert InvalidSessionData();
        }

        for (uint256 i = 0; i < sessionIds.length; i++) {
            if (reactors[i] == address(0)) continue;
            if (!_verifyGating(reactors[i], tokenIdsArray[i], proofs[i])) continue;
            if (tokenIdsArray[i].length == 0) continue;

            uint256 currentDay = block.timestamp / 1 days;
            uint256 maxReactions = tokenIdsArray[i].length * config.reactionsPerToken;
            if (userDailyReactions[reactors[i]][currentDay] >= maxReactions) continue;

            userDailyReactions[reactors[i]][currentDay]++;
            _processReaction(sessionIds[i], reactors[i], msg.sender, true);
        }
    }

    // ============ Messages ============

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function sendMessage(
        uint256 sessionId,
        string calldata contentHash,
        string[] calldata attachments,
        uint256[] calldata tokenIds,
        bytes32[] calldata proof
    ) external payable virtual whenNotPaused nonReentrant {
        if (msg.value < config.messageCost) revert InsufficientPayment();

        if (!_verifyGating(msg.sender, tokenIds, proof)) revert InvalidGatingProof();
        if (tokenIds.length == 0) revert NoVotingPower();

        _checkAndUpdateDailyMessageLimit(msg.sender, tokenIds.length);
        _processMessage(sessionId, msg.sender, msg.sender, false, contentHash, attachments);

        _refundExcess(config.messageCost);
    }

    /**
     * @notice Send message on behalf of another user
     */
    function sendMessageFor(
        uint256 sessionId,
        address sender,
        string calldata contentHash,
        string[] calldata attachments,
        uint256[] calldata tokenIds,
        bytes32[] calldata proof
    ) external payable virtual whenNotPaused nonReentrant {
        if (sender == address(0)) revert InvalidAddress();
        if (msg.value < config.messageCost) revert InsufficientPayment();

        bool isApprovedDelegate = isDelegateApproved[sender][msg.sender];
        bool isRelayer = hasRole(RELAYER_ROLE, msg.sender);

        if (!isApprovedDelegate && !isRelayer) revert NotAuthorized();
        if (!_verifyGating(sender, tokenIds, proof)) revert InvalidGatingProof();
        if (tokenIds.length == 0) revert NoVotingPower();

        _checkAndUpdateDailyMessageLimit(sender, tokenIds.length);
        _processMessage(sessionId, sender, msg.sender, true, contentHash, attachments);

        _refundExcess(config.messageCost);
    }

    // ============ Selection ============

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function selectSession() external virtual whenNotPaused nonReentrant returns (uint256) {
        if (block.timestamp < currentPeriodStart + config.periodDuration) {
            revert PeriodNotEnded();
        }

        uint256[] memory candidates = _getCandidateSessions();
        (uint256[] memory topSessionIds, uint256 maxScore) = _findTopSessions(candidates);

        if (topSessionIds.length == 0) {
            return _handleNoWinner();
        }

        uint256 winningSessionId = topSessionIds.length == 1
            ? topSessionIds[0]
            : _applyTieBreaking(topSessionIds);

        Session storage winningSession = sessions[winningSessionId];
        winningSession.isSelected = true;
        winningSession.selectedInPeriod = currentPeriod;
        periodWinners[currentPeriod] = winningSessionId;

        // Mint NFT
        uint256 tokenId = _mintSessionNFT(winningSessionId, winningSession.creator);

        emit NFTMinted(tokenId, winningSessionId, winningSession.creator, currentPeriod);

        // Notify curation module if set
        if (address(curationModule) != address(0)) {
            curationModule.onSessionSelected(winningSessionId, currentPeriod);
        }

        _removeFromEligibleSessions(winningSessionId);
        _applyPendingConfigUpdates();

        currentPeriod++;
        currentPeriodStart = block.timestamp;

        emit SessionSelected(
            currentPeriod - 1,
            winningSessionId,
            winningSession.contentHash,
            winningSession.reactionCount,
            maxScore
        );
        emit PeriodStarted(currentPeriod, block.timestamp);

        return winningSessionId;
    }

    // ============ Delegation ============

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function approveDelegate(address delegate, bool approved) external virtual {
        if (delegate == address(0)) revert InvalidAddress();
        isDelegateApproved[msg.sender][delegate] = approved;
        emit DelegateApproval(msg.sender, delegate, approved);
    }

    // ============ View Functions ============

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function getSession(uint256 sessionId) external view virtual returns (Session memory) {
        if (sessionId >= sessionCount) revert SessionNotFound();
        return sessions[sessionId];
    }

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function getTimeUntilPeriodEnd() external view virtual returns (uint256) {
        uint256 periodEnd = currentPeriodStart + config.periodDuration;
        if (block.timestamp >= periodEnd) return 0;
        return periodEnd - block.timestamp;
    }

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function getRemainingReactions(address user, uint256 tokenCount)
        external view virtual returns (uint256)
    {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxReactions = tokenCount * config.reactionsPerToken;
        uint256 used = userDailyReactions[user][currentDay];
        if (used >= maxReactions) return 0;
        return maxReactions - used;
    }

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function getRemainingMessages(address user, uint256 tokenCount)
        external view virtual returns (uint256)
    {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxMessages = tokenCount * config.messagesPerToken;
        uint256 used = userDailyMessages[user][currentDay];
        if (used >= maxMessages) return 0;
        return maxMessages - used;
    }

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function canReactToday(address user, uint256 tokenCount)
        external view virtual returns (bool)
    {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxReactions = tokenCount * config.reactionsPerToken;
        return userDailyReactions[user][currentDay] < maxReactions;
    }

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function getCurrentPeriod() external view virtual returns (uint256) {
        return currentPeriod;
    }

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function getConfig() external view virtual returns (AgentConfig memory) {
        return config;
    }

    /**
     * @inheritdoc IEdenAgentProtocol
     */
    function getScoringConfig() external view virtual returns (ScoringConfig memory) {
        return scoringConfig;
    }

    function getEligibleSessionsCount() external view virtual returns (uint256) {
        return eligibleSessionIds.length;
    }

    function getSecondsUntilDailyReset() external view virtual returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 nextDayStart = (currentDay + 1) * 1 days;
        return nextDayStart - block.timestamp;
    }

    function getContractBalance() external view virtual returns (uint256) {
        return address(this).balance;
    }

    // ============ Admin Functions ============

    function pause() external virtual onlyRole(ADMIN_ROLE) {
        paused = true;
        emit ConfigUpdated("paused", 0, 1);
    }

    function unpause() external virtual onlyRole(ADMIN_ROLE) {
        paused = false;
        emit ConfigUpdated("paused", 1, 0);
    }

    function addRelayer(address relayer) external virtual onlyRole(ADMIN_ROLE) {
        grantRole(RELAYER_ROLE, relayer);
    }

    function removeRelayer(address relayer) external virtual onlyRole(ADMIN_ROLE) {
        revokeRole(RELAYER_ROLE, relayer);
    }

    function addCreator(address creator) external virtual onlyRole(ADMIN_ROLE) {
        grantRole(CREATOR_ROLE, creator);
    }

    function removeCreator(address creator) external virtual onlyRole(ADMIN_ROLE) {
        revokeRole(CREATOR_ROLE, creator);
    }

    function updateGatingRoot(bytes32 newRoot) external virtual onlyRole(ADMIN_ROLE) {
        if (newRoot == bytes32(0)) revert InvalidGatingProof();
        gatingRoot = newRoot;
        rootTimestamp = block.timestamp;
        emit GatingRootUpdated(newRoot, block.timestamp, block.number);
    }

    function setGatingModule(address module) external virtual onlyRole(ADMIN_ROLE) {
        gatingModule = IGatingModule(module);
    }

    function setCurationModule(address module) external virtual onlyRole(ADMIN_ROLE) {
        curationModule = ICurationModule(module);
        emit ConfigUpdated("curationModule", 0, uint256(uint160(module)));
    }

    function updateTreasury(address newTreasury) external virtual onlyRole(ADMIN_ROLE) {
        if (newTreasury == address(0)) revert InvalidTreasury();
        address previous = treasury;
        treasury = newTreasury;
        emit ConfigUpdated("treasury", uint256(uint160(previous)), uint256(uint160(newTreasury)));
    }

    function withdrawFees() external virtual onlyRole(ADMIN_ROLE) {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NoFeesToWithdraw();
        if (treasury == address(0)) revert TreasuryNotSet();

        (bool success, ) = payable(treasury).call{value: balance}("");
        if (!success) revert TransferFailed();
    }

    function setBaseURI(string calldata baseURI_) external virtual onlyRole(ADMIN_ROLE) {
        _baseTokenURI = baseURI_;
    }

    // ============ Deferred Config Updates ============

    function updatePeriodDuration(uint256 newDuration) external virtual onlyRole(ADMIN_ROLE) {
        if (newDuration < 1 hours || newDuration > 7 days) revert InvalidPeriodDuration();
        _pendingConfig.periodDuration = newDuration;
        hasPendingConfigUpdate = true;
    }

    function updateReactionsPerToken(uint256 newAmount) external virtual onlyRole(ADMIN_ROLE) {
        if (newAmount == 0 || newAmount > 100) revert InvalidReactionsPerToken();
        _pendingConfig.reactionsPerToken = newAmount;
        hasPendingConfigUpdate = true;
    }

    function updateMessagesPerToken(uint256 newAmount) external virtual onlyRole(ADMIN_ROLE) {
        _pendingConfig.messagesPerToken = newAmount;
        hasPendingConfigUpdate = true;
    }

    function updateReactionCost(uint256 newCost) external virtual onlyRole(ADMIN_ROLE) {
        _pendingConfig.reactionCost = newCost;
        hasPendingConfigUpdate = true;
    }

    function updateMessageCost(uint256 newCost) external virtual onlyRole(ADMIN_ROLE) {
        _pendingConfig.messageCost = newCost;
        hasPendingConfigUpdate = true;
    }

    function updateSelectionMode(SelectionMode newMode) external virtual onlyRole(ADMIN_ROLE) {
        config.selectionMode = newMode;
        emit ConfigUpdated("selectionMode", uint256(config.selectionMode), uint256(newMode));
    }

    function updateTieStrategy(TieBreakingStrategy newStrategy) external virtual onlyRole(ADMIN_ROLE) {
        config.tieStrategy = newStrategy;
    }

    function updateNoWinnerStrategy(NoWinnerStrategy newStrategy) external virtual onlyRole(ADMIN_ROLE) {
        config.noWinnerStrategy = newStrategy;
    }

    function updateScoreResetPolicy(bool enabled) external virtual onlyRole(ADMIN_ROLE) {
        config.resetScoresOnPeriodEnd = enabled;
    }

    function updateScoringConfig(
        uint256 reactionWeight,
        uint256 messageWeight,
        uint256 timeDecayMin,
        uint256 timeDecayBase
    ) external virtual onlyRole(ADMIN_ROLE) {
        _pendingScoringConfig = ScoringConfig({
            reactionWeight: reactionWeight,
            messageWeight: messageWeight,
            timeDecayMin: timeDecayMin,
            timeDecayBase: timeDecayBase,
            scaleFactor: scoringConfig.scaleFactor
        });
        hasPendingScoringUpdate = true;
    }

    // ============ Internal Functions ============

    function _processReaction(
        uint256 sessionId,
        address reactor,
        address actor,
        bool isDelegated
    ) internal virtual {
        Session storage session = sessions[sessionId];

        if (session.createdAt == 0) revert SessionNotFound();
        if (session.isSelected || session.isRetracted) revert SessionAlreadySelected();
        if (block.timestamp >= currentPeriodStart + config.periodDuration) revert PeriodEnded();

        uint256 previousCount = userSessionReactionCount[reactor][sessionId];
        userSessionReactionCount[reactor][sessionId] = previousCount + 1;
        session.reactionCount++;

        uint256 previousCountPeriod = userSessionReactionsByPeriod[currentPeriod][reactor][sessionId];
        userSessionReactionsByPeriod[currentPeriod][reactor][sessionId] = previousCountPeriod + 1;

        _updateScores(sessionId, reactor, previousCount, previousCountPeriod);
        totalReactions++;

        // Notify curation module if set
        if (address(curationModule) != address(0)) {
            curationModule.onReaction(sessionId, reactor, 1, msg.value);
        }

        emit ReactionSubmitted(sessionId, reactor, actor, isDelegated, block.timestamp);
    }

    function _processMessage(
        uint256 sessionId,
        address sender_,
        address actor,
        bool isDelegated,
        string memory contentHash,
        string[] memory attachments
    ) internal virtual {
        Session storage session = sessions[sessionId];

        if (session.createdAt == 0) revert SessionNotFound();
        _validateContentHash(contentHash);

        uint256 messageId = messageIdCounter++;

        messages[messageId] = Message({
            id: messageId,
            sessionId: sessionId,
            sender: sender_,
            contentHash: contentHash,
            attachments: attachments,
            createdAt: block.timestamp
        });

        sessionMessageIds[sessionId].push(messageId);
        session.messageCount++;
        totalMessages++;

        // Notify curation module if set
        if (address(curationModule) != address(0)) {
            curationModule.onMessage(sessionId, sender_, msg.value);
        }

        emit MessageSubmitted(messageId, sessionId, sender_, actor, isDelegated, contentHash, block.timestamp);
    }

    function _updateScores(
        uint256 sessionId,
        address reactor,
        uint256 previousCount,
        uint256 previousCountPeriod
    ) internal virtual {
        uint256 timeRemaining = (currentPeriodStart + config.periodDuration) - block.timestamp;
        uint256 decayFactor = _calculateTimeDecay(timeRemaining);

        uint256 oldScore = _updateAllTimeScore(sessionId, previousCount, decayFactor);
        _updatePeriodScore(sessionId, previousCountPeriod, decayFactor);

        emit ScoreUpdated(sessionId, reactor, oldScore, sessionScore[sessionId]);
    }

    function _updateAllTimeScore(
        uint256 sessionId,
        uint256 previousCount,
        uint256 decayFactor
    ) internal virtual returns (uint256 oldScore) {
        uint256 previousScore = previousCount > 0 ? _sqrt(previousCount * SCORE_SCALE_FACTOR) : 0;
        uint256 newScore = _sqrt((previousCount + 1) * SCORE_SCALE_FACTOR);
        uint256 scoreDelta = ((newScore - previousScore) * decayFactor) / scoringConfig.timeDecayBase;

        oldScore = sessionScore[sessionId];
        sessionScore[sessionId] = oldScore + scoreDelta;
    }

    function _updatePeriodScore(
        uint256 sessionId,
        uint256 previousCountPeriod,
        uint256 decayFactor
    ) internal virtual {
        uint256 previousScore = previousCountPeriod > 0 ? _sqrt(previousCountPeriod * SCORE_SCALE_FACTOR) : 0;
        uint256 newScore = _sqrt((previousCountPeriod + 1) * SCORE_SCALE_FACTOR);
        uint256 scoreDelta = ((newScore - previousScore) * decayFactor) / scoringConfig.timeDecayBase;

        uint256 oldScore = sessionScoreByPeriod[currentPeriod][sessionId];
        sessionScoreByPeriod[currentPeriod][sessionId] = oldScore + scoreDelta;
    }

    function _getCandidateSessions() internal view virtual returns (uint256[] memory) {
        return config.selectionMode == SelectionMode.ROUND_BASED
            ? periodSessionIds[currentPeriod]
            : eligibleSessionIds;
    }

    function _findTopSessions(uint256[] memory candidates)
        internal view virtual
        returns (uint256[] memory topIds, uint256 maxScore)
    {
        uint256 maxScore_ = 0;
        uint256 topCount = 0;
        bool usePeriodScores = config.resetScoresOnPeriodEnd;

        for (uint256 i = 0; i < candidates.length; i++) {
            uint256 sessionId = candidates[i];
            if (sessions[sessionId].isRetracted || sessions[sessionId].isSelected) continue;

            uint256 score = usePeriodScores
                ? sessionScoreByPeriod[currentPeriod][sessionId]
                : sessionScore[sessionId];

            if (score > maxScore_) {
                maxScore_ = score;
                topCount = 1;
            } else if (score == maxScore_ && score > 0) {
                topCount++;
            }
        }

        if (topCount == 0) return (new uint256[](0), 0);

        uint256[] memory topSessions = new uint256[](topCount);
        uint256 index = 0;

        for (uint256 i = 0; i < candidates.length; i++) {
            uint256 sessionId = candidates[i];
            if (sessions[sessionId].isRetracted || sessions[sessionId].isSelected) continue;

            uint256 score = usePeriodScores
                ? sessionScoreByPeriod[currentPeriod][sessionId]
                : sessionScore[sessionId];

            if (score == maxScore_) {
                topSessions[index++] = sessionId;
            }
        }

        return (topSessions, maxScore_);
    }

    function _applyTieBreaking(uint256[] memory tiedIds)
        internal view virtual
        returns (uint256)
    {
        if (tiedIds.length == 0) revert NoValidWinner();
        if (tiedIds.length == 1) return tiedIds[0];

        if (config.tieStrategy == TieBreakingStrategy.LOWEST_ID) {
            uint256 lowestId = tiedIds[0];
            for (uint256 i = 1; i < tiedIds.length; i++) {
                if (tiedIds[i] < lowestId) lowestId = tiedIds[i];
            }
            return lowestId;
        } else if (config.tieStrategy == TieBreakingStrategy.EARLIEST_TIME) {
            uint256 selectedId = tiedIds[0];
            uint256 earliestTime = sessions[tiedIds[0]].createdAt;

            for (uint256 i = 1; i < tiedIds.length; i++) {
                uint256 sessionTime = sessions[tiedIds[i]].createdAt;
                if (sessionTime < earliestTime) {
                    earliestTime = sessionTime;
                    selectedId = tiedIds[i];
                }
            }
            return selectedId;
        } else {
            uint256 randomIndex = uint256(keccak256(abi.encodePacked(
                block.timestamp,
                block.prevrandao,
                blockhash(block.number - 1),
                tiedIds.length
            ))) % tiedIds.length;
            return tiedIds[randomIndex];
        }
    }

    function _handleNoWinner() internal virtual returns (uint256) {
        if (config.noWinnerStrategy == NoWinnerStrategy.REVERT) {
            revert NoValidWinner();
        } else {
            uint256 skippedPeriod = currentPeriod;
            _applyPendingConfigUpdates();
            currentPeriod++;
            currentPeriodStart = block.timestamp;

            emit PeriodSkipped(skippedPeriod, block.timestamp);
            emit PeriodStarted(currentPeriod, block.timestamp);
            return 0;
        }
    }

    function _mintSessionNFT(uint256 sessionId, address creator)
        internal virtual
        returns (uint256 tokenId)
    {
        tokenId = _nextTokenId++;
        _safeMint(address(this), tokenId);
        tokenIdToSessionId[tokenId] = sessionId;
        sessionIdToTokenId[sessionId] = tokenId;
    }

    function _checkAndUpdateDailyReactionLimit(address user, uint256 tokenCount) internal virtual {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxReactions = tokenCount * config.reactionsPerToken;
        uint256 used = userDailyReactions[user][currentDay];

        if (used >= maxReactions) revert DailyReactionLimitReached();
        userDailyReactions[user][currentDay]++;
    }

    function _checkAndUpdateDailyMessageLimit(address user, uint256 tokenCount) internal virtual {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxMessages = tokenCount * config.messagesPerToken;
        uint256 used = userDailyMessages[user][currentDay];

        if (used >= maxMessages) revert DailyMessageLimitReached();
        userDailyMessages[user][currentDay]++;
    }

    function _verifyGating(
        address user,
        uint256[] calldata tokenIds,
        bytes32[] calldata proof
    ) internal view virtual returns (bool) {
        // If a gating module is set, use it
        if (address(gatingModule) != address(0)) {
            IGatingModule.VerificationResult memory result = gatingModule.verify(
                user,
                tokenIds,
                abi.encode(proof)
            );
            return result.valid;
        }

        // Otherwise, use legacy Merkle proof verification
        return _verifyMerkleProof(user, tokenIds, proof);
    }

    function _verifyMerkleProof(
        address voter,
        uint256[] calldata tokenIds,
        bytes32[] calldata proof
    ) internal view virtual returns (bool) {
        if (gatingRoot == bytes32(0)) return false;

        // Check for duplicates
        for (uint256 i = 0; i < tokenIds.length; i++) {
            for (uint256 j = i + 1; j < tokenIds.length; j++) {
                if (tokenIds[i] == tokenIds[j]) return false;
            }
        }

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(voter, tokenIds))));
        return _verify(proof, gatingRoot, leaf);
    }

    function _verify(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure virtual returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computedHash = _hashPair(computedHash, proof[i]);
        }
        return computedHash == root;
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure virtual returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _calculateTimeDecay(uint256 timeRemaining)
        internal view virtual
        returns (uint256)
    {
        uint256 periodDuration = config.periodDuration;
        uint256 decayMin = scoringConfig.timeDecayMin;
        uint256 decayBase = scoringConfig.timeDecayBase;

        if (timeRemaining >= periodDuration) return decayBase;

        uint256 hoursRemaining = timeRemaining / 1 hours;
        uint256 periodHours = periodDuration / 1 hours;

        if (periodHours == 0) {
            uint256 minutesRemaining = timeRemaining / 1 minutes;
            uint256 periodMinutes = periodDuration / 1 minutes;
            if (minutesRemaining == 0) return decayMin;
            uint256 minuteDecayFactor = (minutesRemaining * minutesRemaining * decayBase) /
                (periodMinutes * periodMinutes);
            return minuteDecayFactor < decayMin ? decayMin : minuteDecayFactor;
        }

        if (hoursRemaining == 0) return decayMin;

        uint256 decayFactor = (hoursRemaining * hoursRemaining * decayBase) /
            (periodHours * periodHours);
        return decayFactor < decayMin ? decayMin : decayFactor;
    }

    function _validateContentHash(string memory contentHash) internal pure virtual {
        bytes memory b = bytes(contentHash);

        if (b.length == 0) revert InvalidContentHash();

        // CIDv0 (Qm...)
        if (b.length == 46) {
            if (b[0] != 'Q' || b[1] != 'm') revert InvalidContentHash();
        }
        // CIDv1 (b...)
        else if (b.length == 59) {
            if (b[0] != 'b') revert InvalidContentHash();
        }
        // Other valid CID lengths
        else if (b.length < 10 || b.length > 100) {
            revert InvalidContentHash();
        }
    }

    function _removeFromEligibleSessions(uint256 sessionId) internal virtual {
        if (!_isInEligibleArray[sessionId]) return;

        uint256 index = _eligibleSessionIndex[sessionId];
        uint256 lastIndex = eligibleSessionIds.length - 1;

        if (index != lastIndex) {
            uint256 lastSessionId = eligibleSessionIds[lastIndex];
            eligibleSessionIds[index] = lastSessionId;
            _eligibleSessionIndex[lastSessionId] = index;
        }

        eligibleSessionIds.pop();
        delete _eligibleSessionIndex[sessionId];
        _isInEligibleArray[sessionId] = false;
    }

    function _applyPendingConfigUpdates() internal virtual {
        if (hasPendingConfigUpdate) {
            if (_pendingConfig.periodDuration > 0) {
                uint256 prev = config.periodDuration;
                config.periodDuration = _pendingConfig.periodDuration;
                emit ConfigUpdated("periodDuration", prev, config.periodDuration);
            }
            if (_pendingConfig.reactionsPerToken > 0) {
                uint256 prev = config.reactionsPerToken;
                config.reactionsPerToken = _pendingConfig.reactionsPerToken;
                emit ConfigUpdated("reactionsPerToken", prev, config.reactionsPerToken);
            }
            if (_pendingConfig.messagesPerToken > 0) {
                uint256 prev = config.messagesPerToken;
                config.messagesPerToken = _pendingConfig.messagesPerToken;
                emit ConfigUpdated("messagesPerToken", prev, config.messagesPerToken);
            }
            if (_pendingConfig.reactionCost != config.reactionCost) {
                uint256 prev = config.reactionCost;
                config.reactionCost = _pendingConfig.reactionCost;
                emit ConfigUpdated("reactionCost", prev, config.reactionCost);
            }
            if (_pendingConfig.messageCost != config.messageCost) {
                uint256 prev = config.messageCost;
                config.messageCost = _pendingConfig.messageCost;
                emit ConfigUpdated("messageCost", prev, config.messageCost);
            }

            // Reset pending config
            delete _pendingConfig;
            hasPendingConfigUpdate = false;
        }

        if (hasPendingScoringUpdate) {
            scoringConfig = _pendingScoringConfig;
            hasPendingScoringUpdate = false;
            emit ConfigUpdated("scoringConfig", 0, 1);
        }
    }

    function _refundExcess(uint256 cost) internal virtual {
        if (msg.value > cost) {
            (bool success, ) = payable(msg.sender).call{value: msg.value - cost}("");
            if (!success) revert TransferFailed();
        }
    }

    function _sqrt(uint256 x) internal pure virtual returns (uint256 y) {
        if (x == 0) return 0;
        if (x <= 3) return 1;

        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ============ ERC721 Overrides ============

    function tokenURI(uint256 tokenId)
        public view virtual override
        returns (string memory)
    {
        address owner = _ownerOf(tokenId);
        if (owner == address(0)) revert SessionNotFound();

        uint256 sessionId = tokenIdToSessionId[tokenId];
        Session memory session = sessions[sessionId];

        if (bytes(_baseTokenURI).length == 0) {
            return string(abi.encodePacked("ipfs://", session.contentHash));
        }
        return string(abi.encodePacked(_baseTokenURI, session.contentHash));
    }

    function supportsInterface(bytes4 interfaceId)
        public view virtual override(ERC721, AccessControl, ERC1155Holder)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
