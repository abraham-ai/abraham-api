// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../../core/EdenAgentCore.sol";

/**
 * @title AbrahamSeeds
 * @notice Abraham-specific implementation of the Eden Agent Protocol
 * @dev This contract extends EdenAgentCore with Abraham's terminology and specific features:
 *      - Sessions → Seeds
 *      - Reactions → Blessings
 *      - Messages → Commandments
 *      - Periods → Rounds (daily art selection)
 *
 * Abraham's Seeds Protocol:
 * Abraham creates Seeds (creative prompts) that the community can Bless (vote on).
 * Community members can also add Commandments (suggestions/guidance).
 * Each day, the most blessed Seed is selected and minted as an NFT.
 */
contract AbrahamSeeds is EdenAgentCore {

    // ============ Abraham-Specific Events (Aliases) ============

    event SeedSubmitted(
        uint256 indexed seedId,
        address indexed creator,
        string ipfsHash,
        uint256 timestamp
    );

    event SeedRetracted(
        uint256 indexed seedId,
        address indexed creator
    );

    event BlessingSubmitted(
        uint256 indexed seedId,
        address indexed blesser,
        address indexed actor,
        bool isDelegated,
        uint256 timestamp
    );

    event CommandmentSubmitted(
        uint256 indexed commandmentId,
        uint256 indexed seedId,
        address indexed author,
        address actor,
        bool isDelegated,
        string ipfsHash,
        uint256 timestamp
    );

    event WinnerSelected(
        uint256 indexed round,
        uint256 indexed seedId,
        string ipfsHash,
        uint256 blessings,
        uint256 score
    );

    event BlessingPeriodStarted(
        uint256 indexed round,
        uint256 startTime
    );

    event RoundSkipped(
        uint256 indexed round,
        uint256 timestamp
    );

    event SeedNFTMinted(
        uint256 indexed tokenId,
        uint256 indexed seedId,
        address indexed creator,
        uint256 round
    );

    event BlessingScoreUpdated(
        uint256 indexed seedId,
        address indexed blesser,
        uint256 previousScore,
        uint256 newScore
    );

    // ============ Constructor ============

    constructor(
        address admin_,
        address initialCreator_,
        address treasury_
    ) EdenAgentCore(
        "The Seeds",     // NFT name
        "SEED",          // NFT symbol
        admin_,
        treasury_,
        _defaultConfig(),
        _defaultScoringConfig()
    ) {
        if (initialCreator_ != address(0)) {
            _grantRole(CREATOR_ROLE, initialCreator_);
        }

        emit BlessingPeriodStarted(1, block.timestamp);
    }

    function _defaultConfig() internal pure returns (AgentConfig memory) {
        return AgentConfig({
            periodDuration: 1 days,           // Daily rounds
            reactionsPerToken: 1,             // 1 blessing per NFT per day
            messagesPerToken: 1,              // 1 commandment per NFT per day
            reactionCost: 0,                  // Free blessings
            messageCost: 0,                   // Free commandments (can be updated)
            maxSessionsPerPeriod: 1000,
            maxTotalSessions: 100000,
            selectionMode: SelectionMode.ROUND_BASED,
            tieStrategy: TieBreakingStrategy.LOWEST_ID,
            noWinnerStrategy: NoWinnerStrategy.REVERT,
            nftType: NFTType.ERC721,
            resetScoresOnPeriodEnd: false     // Accumulate scores across rounds
        });
    }

    function _defaultScoringConfig() internal pure returns (ScoringConfig memory) {
        return ScoringConfig({
            reactionWeight: 1000,             // Blessings weight
            messageWeight: 0,                 // Commandments don't affect score (yet)
            timeDecayMin: 10,                 // 1% minimum decay
            timeDecayBase: 1000,              // Base for decay calculation
            scaleFactor: 1e6                  // Score precision
        });
    }

    // ============ Abraham-Specific API (Terminology Wrappers) ============

    /**
     * @notice Submit a new Seed for consideration
     * @param ipfsHash IPFS hash of the seed content
     * @return seedId The ID of the newly created seed
     */
    function submitSeed(string calldata ipfsHash)
        external
        whenNotPaused
        onlyRole(CREATOR_ROLE)
        returns (uint256 seedId)
    {
        seedId = _submitSessionInternal(ipfsHash);
        emit SeedSubmitted(seedId, msg.sender, ipfsHash, block.timestamp);
    }

    /**
     * @notice Retract a previously submitted Seed
     * @param seedId The ID of the seed to retract
     */
    function retractSeed(uint256 seedId) external {
        Session storage session = sessions[seedId];

        if (session.createdAt == 0) revert SessionNotFound();
        if (session.creator != msg.sender) revert NotSessionCreator();
        if (session.isSelected) revert CannotRetractSelectedSession();
        if (session.isRetracted) revert AlreadyRetracted();

        session.isRetracted = true;
        _removeFromEligibleSessions(seedId);

        emit SeedRetracted(seedId, msg.sender);
    }

    /**
     * @notice Bless a Seed (requires valid ownership proof)
     * @param seedId The seed to bless
     * @param tokenIds Token IDs owned by blesser
     * @param merkleProof Merkle proof of ownership
     */
    function blessSeed(
        uint256 seedId,
        uint256[] calldata tokenIds,
        bytes32[] calldata merkleProof
    ) external payable whenNotPaused nonReentrant {
        if (msg.value < config.reactionCost) revert InsufficientPayment();
        if (!_verifyGating(msg.sender, tokenIds, merkleProof)) revert InvalidGatingProof();
        if (tokenIds.length == 0) revert NoVotingPower();

        _checkAndUpdateDailyReactionLimit(msg.sender, tokenIds.length);
        _processBless(seedId, msg.sender, msg.sender, false);

        _refundExcess(config.reactionCost);
    }

    /**
     * @notice Bless a Seed on behalf of another user
     * @param seedId The seed to bless
     * @param blesser The user whose blessing this represents
     * @param tokenIds Token IDs owned by blesser
     * @param merkleProof Merkle proof of ownership
     */
    function blessSeedFor(
        uint256 seedId,
        address blesser,
        uint256[] calldata tokenIds,
        bytes32[] calldata merkleProof
    ) external payable whenNotPaused nonReentrant {
        if (blesser == address(0)) revert InvalidAddress();
        if (msg.value < config.reactionCost) revert InsufficientPayment();

        bool isApprovedDelegate = isDelegateApproved[blesser][msg.sender];
        bool isRelayer = hasRole(RELAYER_ROLE, msg.sender);

        if (!isApprovedDelegate && !isRelayer) revert NotAuthorized();
        if (!_verifyGating(blesser, tokenIds, merkleProof)) revert InvalidGatingProof();
        if (tokenIds.length == 0) revert NoVotingPower();

        _checkAndUpdateDailyReactionLimit(blesser, tokenIds.length);
        _processBless(seedId, blesser, msg.sender, true);

        _refundExcess(config.reactionCost);
    }

    /**
     * @notice Batch bless seeds on behalf of multiple users (relayer only)
     */
    function batchBlessSeedsFor(
        uint256[] calldata seedIds,
        address[] calldata blessers,
        uint256[][] calldata tokenIdsArray,
        bytes32[][] calldata merkleProofs
    ) external whenNotPaused nonReentrant onlyRole(RELAYER_ROLE) {
        if (seedIds.length != blessers.length ||
            seedIds.length != tokenIdsArray.length ||
            seedIds.length != merkleProofs.length ||
            seedIds.length == 0) {
            revert InvalidSessionData();
        }

        for (uint256 i = 0; i < seedIds.length; i++) {
            if (blessers[i] == address(0)) continue;
            if (!_verifyGating(blessers[i], tokenIdsArray[i], merkleProofs[i])) continue;
            if (tokenIdsArray[i].length == 0) continue;

            uint256 currentDay = block.timestamp / 1 days;
            uint256 maxBlessings = tokenIdsArray[i].length * config.reactionsPerToken;
            if (userDailyReactions[blessers[i]][currentDay] >= maxBlessings) continue;

            userDailyReactions[blessers[i]][currentDay]++;
            _processBless(seedIds[i], blessers[i], msg.sender, true);
        }
    }

    /**
     * @notice Add a Commandment (comment) to a Seed
     * @param seedId The seed to comment on
     * @param ipfsHash IPFS hash of the commandment content
     * @param tokenIds Token IDs owned by author
     * @param merkleProof Merkle proof of ownership
     */
    function commentOnSeed(
        uint256 seedId,
        string calldata ipfsHash,
        uint256[] calldata tokenIds,
        bytes32[] calldata merkleProof
    ) external payable whenNotPaused nonReentrant {
        if (msg.value < config.messageCost) revert InsufficientPayment();
        if (!_verifyGating(msg.sender, tokenIds, merkleProof)) revert InvalidGatingProof();
        if (tokenIds.length == 0) revert NoVotingPower();

        _checkAndUpdateDailyMessageLimit(msg.sender, tokenIds.length);
        _processCommandment(seedId, msg.sender, msg.sender, false, ipfsHash);

        _refundExcess(config.messageCost);
    }

    /**
     * @notice Add a Commandment on behalf of another user
     */
    function commentOnSeedFor(
        uint256 seedId,
        address author,
        string calldata ipfsHash,
        uint256[] calldata tokenIds,
        bytes32[] calldata merkleProof
    ) external payable whenNotPaused nonReentrant {
        if (author == address(0)) revert InvalidAddress();
        if (msg.value < config.messageCost) revert InsufficientPayment();

        bool isApprovedDelegate = isDelegateApproved[author][msg.sender];
        bool isRelayer = hasRole(RELAYER_ROLE, msg.sender);

        if (!isApprovedDelegate && !isRelayer) revert NotAuthorized();
        if (!_verifyGating(author, tokenIds, merkleProof)) revert InvalidGatingProof();
        if (tokenIds.length == 0) revert NoVotingPower();

        _checkAndUpdateDailyMessageLimit(author, tokenIds.length);
        _processCommandment(seedId, author, msg.sender, true, ipfsHash);

        _refundExcess(config.messageCost);
    }

    /**
     * @notice Select the daily winner (best blessed Seed)
     * @return seedId The winning seed ID (0 if round was skipped)
     */
    function selectDailyWinner() external whenNotPaused nonReentrant returns (uint256) {
        if (block.timestamp < currentPeriodStart + config.periodDuration) {
            revert PeriodNotEnded();
        }

        uint256[] memory candidates = _getCandidateSessions();
        (uint256[] memory topSeedIds, uint256 maxScore) = _findTopSessions(candidates);

        if (topSeedIds.length == 0) {
            return _handleNoWinnerAbraham();
        }

        uint256 winningSeedId = topSeedIds.length == 1
            ? topSeedIds[0]
            : _applyTieBreaking(topSeedIds);

        Session storage winningSeed = sessions[winningSeedId];
        winningSeed.isSelected = true;
        winningSeed.selectedInPeriod = currentPeriod;
        periodWinners[currentPeriod] = winningSeedId;

        // Mint NFT
        uint256 tokenId = _mintSessionNFT(winningSeedId, winningSeed.creator);

        emit SeedNFTMinted(tokenId, winningSeedId, winningSeed.creator, currentPeriod);

        _removeFromEligibleSessions(winningSeedId);
        _applyPendingConfigUpdates();

        currentPeriod++;
        currentPeriodStart = block.timestamp;

        emit WinnerSelected(
            currentPeriod - 1,
            winningSeedId,
            winningSeed.contentHash,
            winningSeed.reactionCount,
            maxScore
        );
        emit BlessingPeriodStarted(currentPeriod, block.timestamp);

        return winningSeedId;
    }

    // ============ Abraham-Specific View Functions ============

    /**
     * @notice Get a Seed by ID
     */
    function getSeed(uint256 seedId) external view returns (Session memory) {
        if (seedId >= sessionCount) revert SessionNotFound();
        return sessions[seedId];
    }

    /**
     * @notice Get blessing count for a user on a specific seed
     */
    function getBlessingCount(address user, uint256 seedId) external view returns (uint256) {
        return userSessionReactionCount[user][seedId];
    }

    /**
     * @notice Get remaining blessings for a user today
     */
    function getRemainingBlessings(address user, uint256 nftCount) external view returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxBlessings = nftCount * config.reactionsPerToken;
        uint256 used = userDailyReactions[user][currentDay];
        if (used >= maxBlessings) return 0;
        return maxBlessings - used;
    }

    /**
     * @notice Check if user can bless today
     */
    function canBlessToday(address user, uint256 nftCount) external view returns (bool) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxBlessings = nftCount * config.reactionsPerToken;
        return userDailyReactions[user][currentDay] < maxBlessings;
    }

    /**
     * @notice Get remaining commandments for a user today
     */
    function getRemainingCommandments(address user, uint256 nftCount) external view returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxCommandments = nftCount * config.messagesPerToken;
        uint256 used = userDailyMessages[user][currentDay];
        if (used >= maxCommandments) return 0;
        return maxCommandments - used;
    }

    /**
     * @notice Get the current round number
     */
    function getCurrentRound() external view returns (uint256) {
        return currentPeriod;
    }

    /**
     * @notice Get seed score for blessing calculations
     */
    function getSeedBlessingScore(uint256 seedId) external view returns (uint256) {
        return sessionScore[seedId];
    }

    /**
     * @notice Get seed score for a specific round
     */
    function getSeedScoreByRound(uint256 round, uint256 seedId) external view returns (uint256) {
        return sessionScoreByPeriod[round][seedId];
    }

    /**
     * @notice Get blessings per NFT setting
     */
    function blessingsPerNFT() external view returns (uint256) {
        return config.reactionsPerToken;
    }

    /**
     * @notice Get commandments per NFT setting
     */
    function commandmentsPerNFT() external view returns (uint256) {
        return config.messagesPerToken;
    }

    /**
     * @notice Get blessing cost
     */
    function blessingCost() external view returns (uint256) {
        return config.reactionCost;
    }

    /**
     * @notice Get commandment cost
     */
    function commandmentCost() external view returns (uint256) {
        return config.messageCost;
    }

    /**
     * @notice Get voting period duration
     */
    function votingPeriod() external view returns (uint256) {
        return config.periodDuration;
    }

    // ============ Abraham-Specific Admin Functions ============

    /**
     * @notice Update blessings per NFT (deferred to next round)
     */
    function updateBlessingsPerNFT(uint256 newAmount) external onlyRole(ADMIN_ROLE) {
        if (newAmount == 0 || newAmount > 100) revert InvalidReactionsPerToken();
        updateReactionsPerToken(newAmount);
    }

    /**
     * @notice Update commandments per NFT (deferred to next round)
     */
    function updateCommandmentsPerNFT(uint256 newAmount) external onlyRole(ADMIN_ROLE) {
        updateMessagesPerToken(newAmount);
    }

    /**
     * @notice Update blessing cost (deferred to next round)
     */
    function updateBlessingCost(uint256 newCost) external onlyRole(ADMIN_ROLE) {
        updateReactionCost(newCost);
    }

    /**
     * @notice Update commandment cost (deferred to next round)
     */
    function updateCommandmentCost(uint256 newCost) external onlyRole(ADMIN_ROLE) {
        updateMessageCost(newCost);
    }

    /**
     * @notice Update voting period (deferred to next round)
     */
    function updateVotingPeriod(uint256 newPeriod) external onlyRole(ADMIN_ROLE) {
        updatePeriodDuration(newPeriod);
    }

    /**
     * @notice Update the Merkle ownership root
     */
    function updateOwnershipRoot(bytes32 newRoot) external onlyRole(ADMIN_ROLE) {
        updateGatingRoot(newRoot);
    }

    // ============ Internal Functions ============

    function _submitSessionInternal(string calldata ipfsHash) internal returns (uint256 sessionId) {
        _validateContentHash(ipfsHash);

        if (sessionCount >= config.maxTotalSessions) revert MaxSessionsReached();
        if (periodSessionIds[currentPeriod].length >= config.maxSessionsPerPeriod) {
            revert PeriodSessionLimitReached();
        }

        sessionId = sessionCount++;

        sessions[sessionId] = Session({
            id: sessionId,
            creator: msg.sender,
            contentHash: ipfsHash,
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
    }

    function _processBless(
        uint256 seedId,
        address blesser,
        address actor,
        bool isDelegated
    ) internal {
        Session storage seed = sessions[seedId];

        if (seed.createdAt == 0) revert SessionNotFound();
        if (seed.isSelected || seed.isRetracted) revert SessionAlreadySelected();
        if (block.timestamp >= currentPeriodStart + config.periodDuration) revert PeriodEnded();

        uint256 previousCount = userSessionReactionCount[blesser][seedId];
        userSessionReactionCount[blesser][seedId] = previousCount + 1;
        seed.reactionCount++;

        uint256 previousCountPeriod = userSessionReactionsByPeriod[currentPeriod][blesser][seedId];
        userSessionReactionsByPeriod[currentPeriod][blesser][seedId] = previousCountPeriod + 1;

        uint256 oldScore = sessionScore[seedId];
        _updateScores(seedId, blesser, previousCount, previousCountPeriod);
        totalReactions++;

        emit BlessingSubmitted(seedId, blesser, actor, isDelegated, block.timestamp);
        emit BlessingScoreUpdated(seedId, blesser, oldScore, sessionScore[seedId]);
    }

    function _processCommandment(
        uint256 seedId,
        address author,
        address actor,
        bool isDelegated,
        string memory ipfsHash
    ) internal {
        Session storage seed = sessions[seedId];

        if (seed.createdAt == 0) revert SessionNotFound();
        _validateContentHash(ipfsHash);

        uint256 commandmentId = messageIdCounter++;

        // Create empty attachments array
        string[] memory emptyAttachments = new string[](0);

        messages[commandmentId] = Message({
            id: commandmentId,
            sessionId: seedId,
            sender: author,
            contentHash: ipfsHash,
            attachments: emptyAttachments,
            createdAt: block.timestamp
        });

        sessionMessageIds[seedId].push(commandmentId);
        seed.messageCount++;
        totalMessages++;

        emit CommandmentSubmitted(commandmentId, seedId, author, actor, isDelegated, ipfsHash, block.timestamp);
    }

    function _handleNoWinnerAbraham() internal returns (uint256) {
        if (config.noWinnerStrategy == NoWinnerStrategy.REVERT) {
            revert NoValidWinner();
        } else {
            uint256 skippedRound = currentPeriod;
            _applyPendingConfigUpdates();
            currentPeriod++;
            currentPeriodStart = block.timestamp;

            emit RoundSkipped(skippedRound, block.timestamp);
            emit BlessingPeriodStarted(currentPeriod, block.timestamp);
            return 0;
        }
    }

}
