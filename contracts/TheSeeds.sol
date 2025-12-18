// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract TheSeeds is AccessControl, ReentrancyGuard, ERC721, ERC721Holder {

    enum RoundMode { ROUND_BASED, NON_ROUND_BASED }
    enum TieBreakingStrategy { LOWEST_SEED_ID, EARLIEST_SUBMISSION, PSEUDO_RANDOM }
    enum DeadlockStrategy { REVERT, SKIP_ROUND }

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");

    uint256 public constant MAX_SEEDS_PER_ROUND = 1000;
    uint256 public constant MAX_TOTAL_SEEDS = 100000;
    uint256 public constant SCORE_SCALE_FACTOR = 1e6;

    uint256 public votingPeriod;
    uint256 public nextVotingPeriod;
    bytes32 public currentOwnershipRoot;
    uint256 public rootTimestamp;
    uint256 public currentVotingPeriodStart;
    uint256 public seedCount;
    uint256 public currentRound;
    bool public paused;
    uint256 public totalBlessingsCount;
    uint256 public blessingsPerNFT;
    uint256 public nextBlessingsPerNFT;
    bool public resetScoresOnRoundEnd;

    mapping(address => mapping(uint256 => uint256)) public userDailyBlessings;

    RoundMode public roundMode;
    TieBreakingStrategy public tieBreakingStrategy;
    DeadlockStrategy public deadlockStrategy;

    uint256[] public allSeedIds;
    uint256[] public eligibleSeedIds;
    mapping(uint256 => uint256) private eligibleSeedIndex;
    mapping(uint256 => bool) private isInEligibleArray;

    struct Seed {
        uint256 id;
        address creator;
        string ipfsHash;
        uint256 blessings;
        uint256 createdAt;
        bool isWinner;
        bool isRetracted;
        uint256 winnerInRound;
        uint256 submittedInRound;
    }

    mapping(uint256 => Seed) public seeds;
    mapping(uint256 => uint256) public roundWinners;
    mapping(uint256 => uint256[]) public roundSeedIds;
    mapping(address => mapping(address => bool)) public isDelegateApproved;
    mapping(address => mapping(uint256 => uint256)) public userSeedBlessingCount;
    mapping(uint256 => uint256) public seedBlessingScore;
    mapping(uint256 => mapping(uint256 => uint256)) public seedScoreByRound;
    mapping(uint256 => mapping(address => mapping(uint256 => uint256))) public userSeedBlessingsByRound;

    uint256 private _nextTokenId;
    mapping(uint256 => uint256) public tokenIdToSeedId;
    mapping(uint256 => uint256) public seedIdToTokenId;
    string private _baseTokenURI;

    event OwnershipRootUpdated(bytes32 indexed newRoot, uint256 timestamp, uint256 blockNumber);
    event SeedSubmitted(uint256 indexed seedId, address indexed creator, string ipfsHash, uint256 timestamp);
    event WinnerSelected(uint256 indexed round, uint256 indexed seedId, string ipfsHash, uint256 blessings, uint256 score);
    event BlessingPeriodStarted(uint256 indexed round, uint256 startTime);
    event SeedRetracted(uint256 indexed seedId, address indexed creator);
    event ContractPaused(address indexed by);
    event ContractUnpaused(address indexed by);
    event DelegateApproval(address indexed user, address indexed delegate, bool approved);
    event BlessingSubmitted(uint256 indexed seedId, address indexed blesser, address indexed actor, bool isDelegated, uint256 timestamp);
    event VotingPeriodUpdated(uint256 previousPeriod, uint256 newPeriod);
    event BlessingsPerNFTUpdated(uint256 previousAmount, uint256 newAmount);
    event RoundModeUpdated(RoundMode previousMode, RoundMode newMode);
    event TieBreakingStrategyUpdated(TieBreakingStrategy previousStrategy, TieBreakingStrategy newStrategy);
    event DeadlockStrategyUpdated(DeadlockStrategy previousStrategy, DeadlockStrategy newStrategy);
    event RoundSkipped(uint256 indexed round, uint256 timestamp);
    event SeedScoreUpdated(uint256 indexed seedId, address indexed blesser, uint256 previousScore, uint256 newScore);
    event SeedNFTMinted(uint256 indexed tokenId, uint256 indexed seedId, address indexed creator, uint256 round);

    error InvalidMerkleProof();
    error SeedNotFound();
    error SeedAlreadyWinner();
    error BlessingPeriodEnded();
    error VotingPeriodNotEnded();
    error NoValidWinner();
    error InvalidSeedData();
    error NotSeedCreator();
    error CannotRetractWinningSeed();
    error InvalidOwnershipRoot();
    error NoVotingPower();
    error NotAuthorized();
    error InvalidBlesser();
    error DailyBlessingLimitReached();
    error InvalidVotingPeriod();
    error InvalidBlessingsPerNFT();
    error MaxSeedsReached();
    error RoundSeedLimitReached();
    error AlreadyRetracted();
    error InvalidIPFSHash();

    constructor(address _admin, address _initialCreator) ERC721("The Seeds", "SEED") {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);

        if (_initialCreator != address(0)) {
            _grantRole(CREATOR_ROLE, _initialCreator);
        }

        votingPeriod = 1 days;
        blessingsPerNFT = 1;
        currentVotingPeriodStart = block.timestamp;
        currentRound = 1;
        roundMode = RoundMode.ROUND_BASED;
        tieBreakingStrategy = TieBreakingStrategy.LOWEST_SEED_ID;
        deadlockStrategy = DeadlockStrategy.REVERT;
        _nextTokenId = 1;

        emit BlessingPeriodStarted(1, block.timestamp);
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    function submitSeed(string memory _ipfsHash) external whenNotPaused onlyRole(CREATOR_ROLE) returns (uint256) {
        _validateIPFSHash(_ipfsHash);

        if (seedCount >= MAX_TOTAL_SEEDS) revert MaxSeedsReached();
        if (roundSeedIds[currentRound].length >= MAX_SEEDS_PER_ROUND) revert RoundSeedLimitReached();

        uint256 seedId = seedCount++;

        seeds[seedId] = Seed({
            id: seedId,
            creator: msg.sender,
            ipfsHash: _ipfsHash,
            blessings: 0,
            createdAt: block.timestamp,
            isWinner: false,
            isRetracted: false,
            winnerInRound: 0,
            submittedInRound: currentRound
        });

        roundSeedIds[currentRound].push(seedId);
        allSeedIds.push(seedId);
        eligibleSeedIds.push(seedId);
        eligibleSeedIndex[seedId] = eligibleSeedIds.length - 1;
        isInEligibleArray[seedId] = true;

        emit SeedSubmitted(seedId, msg.sender, _ipfsHash, block.timestamp);
        return seedId;
    }

    function retractSeed(uint256 _seedId) external {
        Seed storage seed = seeds[_seedId];

        if (seed.createdAt == 0) revert SeedNotFound();
        if (seed.creator != msg.sender) revert NotSeedCreator();
        if (seed.isWinner) revert CannotRetractWinningSeed();
        if (seed.isRetracted) revert AlreadyRetracted();

        seed.isRetracted = true;
        _removeFromEligibleSeeds(_seedId);

        emit SeedRetracted(_seedId, msg.sender);
    }

    function approveDelegate(address _delegate, bool _approved) external {
        if (_delegate == address(0)) revert InvalidBlesser();
        isDelegateApproved[msg.sender][_delegate] = _approved;
        emit DelegateApproval(msg.sender, _delegate, _approved);
    }

    function blessSeed(uint256 _seedId, uint256[] memory _tokenIds, bytes32[] memory _merkleProof)
        external whenNotPaused nonReentrant {
        if (!_verifyOwnership(msg.sender, _tokenIds, _merkleProof)) revert InvalidMerkleProof();
        if (_tokenIds.length == 0) revert NoVotingPower();

        _checkAndUpdateDailyLimit(msg.sender, _tokenIds.length);
        _processBless(_seedId, msg.sender, msg.sender, false);
    }

    function blessSeedFor(uint256 _seedId, address _blesser, uint256[] memory _tokenIds, bytes32[] memory _merkleProof)
        external whenNotPaused nonReentrant {
        if (_blesser == address(0)) revert InvalidBlesser();

        bool isApprovedDelegate = isDelegateApproved[_blesser][msg.sender];
        bool isRelayer = hasRole(RELAYER_ROLE, msg.sender);

        if (!isApprovedDelegate && !isRelayer) revert NotAuthorized();
        if (!_verifyOwnership(_blesser, _tokenIds, _merkleProof)) revert InvalidMerkleProof();
        if (_tokenIds.length == 0) revert NoVotingPower();

        _checkAndUpdateDailyLimit(_blesser, _tokenIds.length);
        _processBless(_seedId, _blesser, msg.sender, true);
    }

    function batchBlessSeedsFor(
        uint256[] calldata _seedIds,
        address[] calldata _blessers,
        uint256[][] calldata _tokenIdsArray,
        bytes32[][] calldata _merkleProofs
    ) external whenNotPaused nonReentrant onlyRole(RELAYER_ROLE) {
        if (_seedIds.length != _blessers.length || _seedIds.length != _tokenIdsArray.length ||
            _seedIds.length != _merkleProofs.length || _seedIds.length == 0) {
            revert InvalidSeedData();
        }

        for (uint256 i = 0; i < _seedIds.length; i++) {
            if (_blessers[i] == address(0)) continue;
            if (!_verifyOwnership(_blessers[i], _tokenIdsArray[i], _merkleProofs[i])) continue;
            if (_tokenIdsArray[i].length == 0) continue;

            uint256 currentDay = block.timestamp / 1 days;
            uint256 maxBlessings = _tokenIdsArray[i].length * blessingsPerNFT;
            if (userDailyBlessings[_blessers[i]][currentDay] >= maxBlessings) continue;

            userDailyBlessings[_blessers[i]][currentDay]++;
            _processBless(_seedIds[i], _blessers[i], msg.sender, true);
        }
    }

    function _checkAndUpdateDailyLimit(address _user, uint256 _nftCount) internal {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxBlessings = _nftCount * blessingsPerNFT;
        uint256 currentBlessings = userDailyBlessings[_user][currentDay];

        if (currentBlessings >= maxBlessings) revert DailyBlessingLimitReached();
        userDailyBlessings[_user][currentDay]++;
    }

    function _processBless(uint256 _seedId, address _blesser, address _actor, bool _isDelegated) internal {
        Seed storage seed = seeds[_seedId];

        if (seed.createdAt == 0) revert SeedNotFound();
        if (seed.isWinner || seed.isRetracted) revert SeedAlreadyWinner();
        if (block.timestamp >= currentVotingPeriodStart + votingPeriod) revert BlessingPeriodEnded();

        uint256 previousCount = userSeedBlessingCount[_blesser][_seedId];
        userSeedBlessingCount[_blesser][_seedId] = previousCount + 1;
        seed.blessings++;

        uint256 previousCountRound = userSeedBlessingsByRound[currentRound][_blesser][_seedId];
        userSeedBlessingsByRound[currentRound][_blesser][_seedId] = previousCountRound + 1;

        _updateBlessingScores(_seedId, _blesser, previousCount, previousCountRound);
        totalBlessingsCount++;

        emit BlessingSubmitted(_seedId, _blesser, _actor, _isDelegated, block.timestamp);
    }

    function _updateBlessingScores(uint256 _seedId, address _blesser, uint256 _previousCount, uint256 _previousCountRound) internal {
        uint256 timeRemaining = (currentVotingPeriodStart + votingPeriod) - block.timestamp;
        uint256 decayFactor = _calculateBlessingTimeDecay(timeRemaining);

        uint256 oldScore = _updateAllTimeScore(_seedId, _previousCount, decayFactor);
        _updateRoundScore(_seedId, _previousCountRound, decayFactor);

        emit SeedScoreUpdated(_seedId, _blesser, oldScore, seedBlessingScore[_seedId]);
    }

    function _updateAllTimeScore(uint256 _seedId, uint256 _previousCount, uint256 _decayFactor) internal returns (uint256 oldScore) {
        uint256 previousScore = _previousCount > 0 ? sqrt(_previousCount * SCORE_SCALE_FACTOR) : 0;
        uint256 newScore = sqrt((_previousCount + 1) * SCORE_SCALE_FACTOR);
        uint256 scoreDelta = ((newScore - previousScore) * _decayFactor) / 1000;

        oldScore = seedBlessingScore[_seedId];
        seedBlessingScore[_seedId] = oldScore + scoreDelta;
    }

    function _updateRoundScore(uint256 _seedId, uint256 _previousCountRound, uint256 _decayFactor) internal {
        uint256 previousScoreRound = _previousCountRound > 0 ? sqrt(_previousCountRound * SCORE_SCALE_FACTOR) : 0;
        uint256 newScoreRound = sqrt((_previousCountRound + 1) * SCORE_SCALE_FACTOR);
        uint256 scoreDeltaRound = ((newScoreRound - previousScoreRound) * _decayFactor) / 1000;

        uint256 oldScoreRound = seedScoreByRound[currentRound][_seedId];
        seedScoreByRound[currentRound][_seedId] = oldScoreRound + scoreDeltaRound;
    }

    function selectDailyWinner() external whenNotPaused nonReentrant returns (uint256) {
        if (block.timestamp < currentVotingPeriodStart + votingPeriod) revert VotingPeriodNotEnded();

        uint256[] memory candidateSeedIds = _getCandidateSeeds();
        (uint256[] memory topSeedIds, uint256 maxScore) = _findTopSeeds(candidateSeedIds);

        if (topSeedIds.length == 0) return _handleDeadlock();

        uint256 winningSeedId = topSeedIds.length == 1 ? topSeedIds[0] : _applyTieBreaking(topSeedIds);

        Seed storage winningSeed = seeds[winningSeedId];
        winningSeed.isWinner = true;
        winningSeed.winnerInRound = currentRound;
        roundWinners[currentRound] = winningSeedId;

        uint256 tokenId = _nextTokenId++;
        _safeMint(address(this), tokenId);
        tokenIdToSeedId[tokenId] = winningSeedId;
        seedIdToTokenId[winningSeedId] = tokenId;

        emit SeedNFTMinted(tokenId, winningSeedId, winningSeed.creator, currentRound);

        _removeFromEligibleSeeds(winningSeedId);
        _applyDeferredConfigUpdates();

        currentRound++;
        currentVotingPeriodStart = block.timestamp;

        emit WinnerSelected(currentRound - 1, winningSeedId, winningSeed.ipfsHash, winningSeed.blessings, maxScore);
        emit BlessingPeriodStarted(currentRound, block.timestamp);

        return winningSeedId;
    }

    function _getCandidateSeeds() internal view returns (uint256[] memory) {
        return roundMode == RoundMode.ROUND_BASED ? roundSeedIds[currentRound] : eligibleSeedIds;
    }

    function _findTopSeeds(uint256[] memory candidateSeedIds) internal view returns (uint256[] memory topSeedIds, uint256 maxScore) {
        uint256 maxScore_ = 0;
        uint256 topCount = 0;
        bool useRoundScores = resetScoresOnRoundEnd;

        for (uint256 i = 0; i < candidateSeedIds.length; i++) {
            uint256 seedId = candidateSeedIds[i];
            if (seeds[seedId].isRetracted || seeds[seedId].isWinner) continue;

            uint256 score = useRoundScores ? seedScoreByRound[currentRound][seedId] : seedBlessingScore[seedId];

            if (score > maxScore_) {
                maxScore_ = score;
                topCount = 1;
            } else if (score == maxScore_ && score > 0) {
                topCount++;
            }
        }

        if (topCount == 0) return (new uint256[](0), 0);

        uint256[] memory topSeeds = new uint256[](topCount);
        uint256 index = 0;

        for (uint256 i = 0; i < candidateSeedIds.length; i++) {
            uint256 seedId = candidateSeedIds[i];
            if (seeds[seedId].isRetracted || seeds[seedId].isWinner) continue;

            uint256 score = useRoundScores ? seedScoreByRound[currentRound][seedId] : seedBlessingScore[seedId];

            if (score == maxScore_) {
                topSeeds[index++] = seedId;
            }
        }

        return (topSeeds, maxScore_);
    }

    function _applyTieBreaking(uint256[] memory tiedSeedIds) internal view returns (uint256) {
        if (tiedSeedIds.length == 0) revert NoValidWinner();
        if (tiedSeedIds.length == 1) return tiedSeedIds[0];

        if (tieBreakingStrategy == TieBreakingStrategy.LOWEST_SEED_ID) {
            uint256 lowestId = tiedSeedIds[0];
            for (uint256 i = 1; i < tiedSeedIds.length; i++) {
                if (tiedSeedIds[i] < lowestId) lowestId = tiedSeedIds[i];
            }
            return lowestId;
        } else if (tieBreakingStrategy == TieBreakingStrategy.EARLIEST_SUBMISSION) {
            uint256 selectedId = tiedSeedIds[0];
            uint256 earliestTime = seeds[tiedSeedIds[0]].createdAt;

            for (uint256 i = 1; i < tiedSeedIds.length; i++) {
                uint256 seedTime = seeds[tiedSeedIds[i]].createdAt;
                if (seedTime < earliestTime) {
                    earliestTime = seedTime;
                    selectedId = tiedSeedIds[i];
                }
            }
            return selectedId;
        } else {
            uint256 randomIndex = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, blockhash(block.number - 1), tiedSeedIds.length))) % tiedSeedIds.length;
            return tiedSeedIds[randomIndex];
        }
    }

    function _handleDeadlock() internal returns (uint256) {
        if (deadlockStrategy == DeadlockStrategy.REVERT) {
            revert NoValidWinner();
        } else {
            uint256 skippedRound = currentRound;
            _applyDeferredConfigUpdates();
            currentRound++;
            currentVotingPeriodStart = block.timestamp;

            emit RoundSkipped(skippedRound, block.timestamp);
            emit BlessingPeriodStarted(currentRound, block.timestamp);
            return 0;
        }
    }

    function addRelayer(address _relayer) external onlyRole(ADMIN_ROLE) {
        grantRole(RELAYER_ROLE, _relayer);
    }

    function removeRelayer(address _relayer) external onlyRole(ADMIN_ROLE) {
        revokeRole(RELAYER_ROLE, _relayer);
    }

    function addCreator(address _creator) external onlyRole(ADMIN_ROLE) {
        grantRole(CREATOR_ROLE, _creator);
    }

    function removeCreator(address _creator) external onlyRole(ADMIN_ROLE) {
        revokeRole(CREATOR_ROLE, _creator);
    }

    function updateOwnershipRoot(bytes32 _newRoot) external onlyRole(ADMIN_ROLE) {
        if (_newRoot == bytes32(0)) revert InvalidOwnershipRoot();
        currentOwnershipRoot = _newRoot;
        rootTimestamp = block.timestamp;
        emit OwnershipRootUpdated(_newRoot, block.timestamp, block.number);
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    function updateVotingPeriod(uint256 _newVotingPeriod) external onlyRole(ADMIN_ROLE) {
        if (_newVotingPeriod < 1 hours || _newVotingPeriod > 7 days) revert InvalidVotingPeriod();
        nextVotingPeriod = _newVotingPeriod;
    }

    function updateBlessingsPerNFT(uint256 _newBlessingsPerNFT) external onlyRole(ADMIN_ROLE) {
        if (_newBlessingsPerNFT == 0 || _newBlessingsPerNFT > 100) revert InvalidBlessingsPerNFT();
        nextBlessingsPerNFT = _newBlessingsPerNFT;
    }

    function updateScoreResetPolicy(bool _enabled) external onlyRole(ADMIN_ROLE) {
        resetScoresOnRoundEnd = _enabled;
    }

    function updateRoundMode(RoundMode _newRoundMode) external onlyRole(ADMIN_ROLE) {
        RoundMode previousMode = roundMode;
        roundMode = _newRoundMode;
        emit RoundModeUpdated(previousMode, _newRoundMode);
    }

    function updateTieBreakingStrategy(TieBreakingStrategy _newStrategy) external onlyRole(ADMIN_ROLE) {
        TieBreakingStrategy previousStrategy = tieBreakingStrategy;
        tieBreakingStrategy = _newStrategy;
        emit TieBreakingStrategyUpdated(previousStrategy, _newStrategy);
    }

    function updateDeadlockStrategy(DeadlockStrategy _newStrategy) external onlyRole(ADMIN_ROLE) {
        DeadlockStrategy previousStrategy = deadlockStrategy;
        deadlockStrategy = _newStrategy;
        emit DeadlockStrategyUpdated(previousStrategy, _newStrategy);
    }

    function setBaseURI(string memory baseURI_) external onlyRole(ADMIN_ROLE) {
        _baseTokenURI = baseURI_;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        address owner = _ownerOf(tokenId);
        if (owner == address(0)) revert SeedNotFound();

        uint256 seedId = tokenIdToSeedId[tokenId];
        Seed memory seed = seeds[seedId];

        if (bytes(_baseTokenURI).length == 0) {
            return string(abi.encodePacked("ipfs://", seed.ipfsHash));
        }
        return string(abi.encodePacked(_baseTokenURI, seed.ipfsHash));
    }

    function getSeedIdByTokenId(uint256 tokenId) external view returns (uint256) {
        if (_ownerOf(tokenId) == address(0)) revert SeedNotFound();
        return tokenIdToSeedId[tokenId];
    }

    function getTokenIdBySeedId(uint256 seedId) external view returns (uint256) {
        return seedIdToTokenId[seedId];
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return interfaceId == type(IERC721Receiver).interfaceId || super.supportsInterface(interfaceId);
    }

    function getSeed(uint256 _seedId) external view returns (Seed memory) {
        if (_seedId >= seedCount) revert SeedNotFound();
        return seeds[_seedId];
    }

    function getTimeUntilPeriodEnd() external view returns (uint256) {
        uint256 periodEnd = currentVotingPeriodStart + votingPeriod;
        if (block.timestamp >= periodEnd) return 0;
        return periodEnd - block.timestamp;
    }

    function getSeedsByRound(uint256 _round) external view returns (Seed[] memory) {
        uint256[] memory seedIds = roundSeedIds[_round];
        Seed[] memory result = new Seed[](seedIds.length);

        for (uint256 i = 0; i < seedIds.length; i++) {
            result[i] = seeds[seedIds[i]];
        }
        return result;
    }

    function getCurrentRoundSeeds() external view returns (Seed[] memory) {
        return this.getSeedsByRound(currentRound);
    }

    function getBlessingCount(address _user, uint256 _seedId) external view returns (uint256) {
        return userSeedBlessingCount[_user][_seedId];
    }

    function isDelegate(address _user, address _delegate) external view returns (bool) {
        return isDelegateApproved[_user][_delegate];
    }

    function getUserDailyBlessingCount(address _user) external view returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        return userDailyBlessings[_user][currentDay];
    }

    function getRemainingBlessings(address _user, uint256 _nftCount) external view returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxBlessings = _nftCount * blessingsPerNFT;
        uint256 used = userDailyBlessings[_user][currentDay];
        if (used >= maxBlessings) return 0;
        return maxBlessings - used;
    }

    function canBlessToday(address _user, uint256 _nftCount) external view returns (bool) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxBlessings = _nftCount * blessingsPerNFT;
        return userDailyBlessings[_user][currentDay] < maxBlessings;
    }

    function getRoundMode() external view returns (RoundMode) {
        return roundMode;
    }

    function getTieBreakingStrategy() external view returns (TieBreakingStrategy) {
        return tieBreakingStrategy;
    }

    function getDeadlockStrategy() external view returns (DeadlockStrategy) {
        return deadlockStrategy;
    }

    function getEligibleSeedsCount() external view returns (uint256) {
        return eligibleSeedIds.length;
    }

    function getSecondsUntilDailyReset() external view returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 nextDayStart = (currentDay + 1) * 1 days;
        return nextDayStart - block.timestamp;
    }

    function getCurrentLeaders() external view returns (uint256[] memory leadingSeedIds, uint256 score) {
        uint256[] memory candidateSeeds = roundMode == RoundMode.ROUND_BASED ? roundSeedIds[currentRound] : allSeedIds;
        uint256 maxScore = 0;
        uint256 leaderCount = 0;

        for (uint256 i = 0; i < candidateSeeds.length; i++) {
            uint256 seedId = candidateSeeds[i];
            if (!seeds[seedId].isWinner && !seeds[seedId].isRetracted) {
                uint256 seedScore = seedBlessingScore[seedId];
                if (seedScore > maxScore) {
                    maxScore = seedScore;
                    leaderCount = 1;
                } else if (seedScore == maxScore && seedScore > 0) {
                    leaderCount++;
                }
            }
        }

        if (leaderCount == 0) return (new uint256[](0), 0);

        uint256[] memory leaders = new uint256[](leaderCount);
        uint256 index = 0;

        for (uint256 i = 0; i < candidateSeeds.length; i++) {
            uint256 seedId = candidateSeeds[i];
            if (!seeds[seedId].isWinner && !seeds[seedId].isRetracted && seedBlessingScore[seedId] == maxScore) {
                leaders[index++] = seedId;
            }
        }

        return (leaders, maxScore);
    }

    function _verifyOwnership(address _voter, uint256[] memory _tokenIds, bytes32[] memory _merkleProof) internal view returns (bool) {
        if (currentOwnershipRoot == bytes32(0)) return false;

        for (uint256 i = 0; i < _tokenIds.length; i++) {
            for (uint256 j = i + 1; j < _tokenIds.length; j++) {
                if (_tokenIds[i] == _tokenIds[j]) return false;
            }
        }

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(_voter, _tokenIds))));
        return MerkleProof.verify(_merkleProof, currentOwnershipRoot, leaf);
    }

    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        if (x <= 3) return 1;

        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function _calculateBlessingTimeDecay(uint256 timeRemaining) internal view returns (uint256) {
        if (timeRemaining >= votingPeriod) return 1000;

        uint256 hoursRemaining = timeRemaining / 1 hours;
        uint256 periodHours = votingPeriod / 1 hours;

        if (periodHours == 0) {
            uint256 minutesRemaining = timeRemaining / 1 minutes;
            uint256 periodMinutes = votingPeriod / 1 minutes;
            if (minutesRemaining == 0) return 10;
            uint256 minuteDecayFactor = (minutesRemaining * minutesRemaining * 1000) / (periodMinutes * periodMinutes);
            return minuteDecayFactor < 10 ? 10 : minuteDecayFactor;
        }

        if (hoursRemaining == 0) return 10;

        uint256 decayFactor = (hoursRemaining * hoursRemaining * 1000) / (periodHours * periodHours);
        return decayFactor < 10 ? 10 : decayFactor;
    }

    function _validateIPFSHash(string memory _ipfsHash) internal pure {
        bytes memory b = bytes(_ipfsHash);

        if (b.length == 0) revert InvalidIPFSHash();

        if (b.length == 46) {
            if (b[0] != 'Q' || b[1] != 'm') revert InvalidIPFSHash();
        } else if (b.length == 59) {
            if (b[0] != 'b') revert InvalidIPFSHash();
        } else if (b.length < 10 || b.length > 100) {
            revert InvalidIPFSHash();
        }
    }

    function _removeFromEligibleSeeds(uint256 _seedId) internal {
        if (!isInEligibleArray[_seedId]) return;

        uint256 index = eligibleSeedIndex[_seedId];
        uint256 lastIndex = eligibleSeedIds.length - 1;

        if (index != lastIndex) {
            uint256 lastSeedId = eligibleSeedIds[lastIndex];
            eligibleSeedIds[index] = lastSeedId;
            eligibleSeedIndex[lastSeedId] = index;
        }

        eligibleSeedIds.pop();
        delete eligibleSeedIndex[_seedId];
        isInEligibleArray[_seedId] = false;
    }

    function _applyDeferredConfigUpdates() internal {
        if (nextVotingPeriod > 0) {
            uint256 previous = votingPeriod;
            votingPeriod = nextVotingPeriod;
            nextVotingPeriod = 0;
            emit VotingPeriodUpdated(previous, votingPeriod);
        }

        if (nextBlessingsPerNFT > 0) {
            uint256 previous = blessingsPerNFT;
            blessingsPerNFT = nextBlessingsPerNFT;
            nextBlessingsPerNFT = 0;
            emit BlessingsPerNFTUpdated(previous, blessingsPerNFT);
        }
    }
}