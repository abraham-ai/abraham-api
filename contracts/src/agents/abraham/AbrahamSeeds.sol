// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../../core/EdenAgent.sol";

/**
 * @title AbrahamSeeds
 * @notice Abraham-specific wrapper providing Seeds/Blessings terminology
 */
contract AbrahamSeeds is EdenAgent {
    // Abraham Events
    event SeedSubmitted(uint256 indexed seedId, address indexed creator, string ipfsHash, uint256 round);
    event BlessingSubmitted(uint256 indexed seedId, address indexed blesser, uint256 score);
    event CommandmentSubmitted(uint256 indexed id, uint256 indexed seedId, address indexed author, string ipfsHash);
    event CreationMinted(uint256 indexed round, uint256 indexed seedId, uint256 tokenId);
    event RoundStarted(uint256 indexed round);
    event PriestsRewarded(uint256 indexed tokenId, address[] priests, uint256[] amounts);

    struct Seed {
        uint256 id;
        address creator;
        string ipfsHash;
        uint256 blessings;
        uint256 score;
        uint256 commandmentCount;
        uint256 createdAt;
        uint256 submittedInRound;
        uint256 creationRound;
        bool isRetracted;
    }

    constructor(
        address admin,
        address _treasury,
        address _gatingModule,
        string memory baseURI
    ) EdenAgent(admin, _treasury, _gatingModule, baseURI) {
        emit RoundStarted(1);
    }

    function submitSeed(string calldata ipfsHash) external whenNotPaused onlyRole(CREATOR_ROLE) returns (uint256) {
        _validateContentHash(ipfsHash);
        uint256 seedId = sessionCount++;

        sessions[seedId] = Session({
            id: seedId,
            creator: msg.sender,
            contentHash: ipfsHash,
            reactionCount: 0,
            reactionScore: 0,
            messageCount: 0,
            createdAt: block.timestamp,
            submittedInPeriod: currentPeriod,
            selectedInPeriod: 0,
            isRetracted: false
        });

        periodSessionIds[currentPeriod].push(seedId);
        eligibleSessionIds.push(seedId);
        eligibleSessionIndex[seedId] = eligibleSessionIds.length - 1;
        isEligible[seedId] = true;

        emit SeedSubmitted(seedId, msg.sender, ipfsHash, currentPeriod);
        emit SessionSubmitted(seedId, msg.sender, ipfsHash, currentPeriod);
        return seedId;
    }

    function retractSeed(uint256 seedId) external {
        Session storage s = sessions[seedId];
        if (s.createdAt == 0) revert SessionNotFound();
        if (s.creator != msg.sender) revert NotSessionCreator();
        if (s.selectedInPeriod > 0) revert SessionAlreadySelected();
        if (s.isRetracted) revert AlreadyRetracted();
        s.isRetracted = true;
        _removeFromEligible(seedId);
        emit SessionRetracted(seedId, msg.sender);
    }

    function blessSeed(uint256 seedId, uint256[] calldata tokenIds, bytes calldata proof) external payable {
        react(seedId, tokenIds, proof);
        emit BlessingSubmitted(seedId, msg.sender, sessions[seedId].reactionScore);
    }

    function blessSeedFor(uint256 seedId, address blesser, uint256[] calldata tokenIds, bytes calldata proof) external payable {
        reactFor(seedId, blesser, tokenIds, proof);
        emit BlessingSubmitted(seedId, blesser, sessions[seedId].reactionScore);
    }

    function addCommandment(uint256 seedId, string calldata ipfsHash, uint256[] calldata tokenIds, bytes calldata proof) external payable {
        sendMessage(seedId, ipfsHash, tokenIds, proof);
        emit CommandmentSubmitted(messageCount - 1, seedId, msg.sender, ipfsHash);
    }

    function selectDailyWinner() external returns (uint256 seedId) {
        seedId = selectSession();
        if (seedId > 0) {
            emit CreationMinted(currentPeriod - 1, seedId, sessionToTokenId[seedId]);
        }
        emit RoundStarted(currentPeriod);
    }

    /// @notice Reward top curators (priests) with creation editions - based on off-chain leaderboard
    function rewardPriests(
        uint256 tokenId,
        address[] calldata priests,
        uint256[] calldata amounts
    ) external {
        distributeCuratorEditions(tokenId, priests, amounts);
        emit PriestsRewarded(tokenId, priests, amounts);
    }

    /// @notice Purchase a creation edition
    function purchaseCreation(uint256 tokenId, uint256 amount) external payable {
        purchaseEdition(tokenId, amount);
    }

    // View functions
    function getSeed(uint256 seedId) external view returns (Seed memory) {
        Session storage s = sessions[seedId];
        return Seed(s.id, s.creator, s.contentHash, s.reactionCount, s.reactionScore, s.messageCount, s.createdAt, s.submittedInPeriod, s.selectedInPeriod, s.isRetracted);
    }

    function getCurrentRound() external view returns (uint256) { return currentPeriod; }
    function getSeedCount() external view returns (uint256) { return sessionCount; }
    function getBlessingCount(address user, uint256 seedId) external view returns (uint256) { return userSessionReactions[user][seedId]; }
    function getSeedBlessingScore(uint256 seedId) external view returns (uint256) { return sessions[seedId].reactionScore; }
    function getTimeUntilRoundEnd() external view returns (uint256) {
        uint256 end = currentPeriodStart + config.periodDuration;
        return block.timestamp >= end ? 0 : end - block.timestamp;
    }
    function getEligibleSeedsCount() external view returns (uint256) { return eligibleSessionIds.length; }
    function getRemainingBlessings(address user, uint256 tokenCount) external view returns (uint256) {
        uint256 max = tokenCount * config.reactionsPerToken;
        uint256 used = userDailyReactions[user][block.timestamp / 1 days];
        return used >= max ? 0 : max - used;
    }
    function canBlessToday(address user, uint256 tokenCount) external view returns (bool) {
        return userDailyReactions[user][block.timestamp / 1 days] < tokenCount * config.reactionsPerToken;
    }
    function getCommandmentCount(uint256 seedId) external view returns (uint256) { return sessions[seedId].messageCount; }
    function getRoundWinner(uint256 round) external view returns (uint256) { return periodWinners[round]; }
    function getTokenIdBySeedId(uint256 seedId) external view returns (uint256) { return sessionToTokenId[seedId]; }
    function getSeedIdByTokenId(uint256 tokenId) external view returns (uint256) { return tokenIdToSessionId[tokenId]; }
    function blessingsPerNFT() external view returns (uint256) { return config.reactionsPerToken; }
    function votingPeriod() external view returns (uint256) { return config.periodDuration; }

    // Edition view functions
    function getCreationEditionInfo(uint256 tokenId) external view returns (
        uint256 seedId,
        uint256 totalMinted,
        uint256 creatorEditions,
        uint256 curatorEditions,
        uint256 curatorDistributed,
        uint256 publicEditions,
        uint256 publicSold,
        uint256 availableForSale
    ) {
        seedId = tokenIdToSessionId[tokenId];
        creatorEditions = editionAlloc.creatorAmount;
        curatorEditions = editionAlloc.curatorAmount;
        curatorDistributed = curatorEditionsDistributed[tokenId];
        publicEditions = editionAlloc.publicAmount;
        publicSold = editionsSold[tokenId];
        totalMinted = creatorEditions + curatorEditions + publicEditions;
        availableForSale = balanceOf(address(this), tokenId);
    }

    function getEditionPrice() external view returns (uint256) { return config.editionPrice; }
    function getEditionAllocation() external view returns (uint256 creator, uint256 curator, uint256 public_) {
        return (editionAlloc.creatorAmount, editionAlloc.curatorAmount, editionAlloc.publicAmount);
    }
}
