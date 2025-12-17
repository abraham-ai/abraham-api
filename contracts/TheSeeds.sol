// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title TheSeeds
 * @notice L2 governance contract for proposing and blessing Seeds (artworks)
 * @dev Uses Merkle proofs to verify L1 FirstWorks NFT ownership for blessing eligibility
 *
 * Blessing Model:
 * - Users can bless seeds to show support (multiple blessings per seed allowed)
 * - Winner selected daily based on sqrt(per-user blessings) with time decay
 * - Each FirstWorks NFT holder can bless once per day per NFT
 * - Winning Seed is marked as winner for that round
 *
 * Delegation:
 * - Users can delegate blessing rights to trusted parties (e.g., backend server, smart wallets)
 * - Backend relayer can submit blessings on behalf of verified users
 *
 * Round Modes:
 * - ROUND_BASED: Select winners from current round only (traditional)
 * - NON_ROUND_BASED: Select winners from entire pool of eligible seeds
 *
 * Tie-Breaking:
 * - Configurable strategies for handling multiple seeds with same score
 *
 * Deadlock Handling:
 * - Configurable strategies for handling cases with no eligible seeds
 */
contract TheSeeds is AccessControl, ReentrancyGuard {

    /*//////////////////////////////////////////////////////////////
                                ENUMS
    //////////////////////////////////////////////////////////////*/

    /// @notice Round mode for winner selection
    enum RoundMode {
        ROUND_BASED,      // Select from current round only
        NON_ROUND_BASED   // Select from all eligible seeds
    }

    /// @notice Strategy for breaking ties when multiple seeds have same score
    enum TieBreakingStrategy {
        EARLIEST_SUBMISSION,  // Select seed with earliest timestamp
        LATEST_SUBMISSION,    // Select seed with latest timestamp
        LOWEST_SEED_ID,       // Select seed with lowest ID
        HIGHEST_SEED_ID,      // Select seed with highest ID
        PSEUDO_RANDOM         // Use blockhash-based randomness
    }

    /// @notice Strategy for handling deadlock (no eligible seeds)
    enum DeadlockStrategy {
        REVERT,              // Revert transaction (current behavior)
        SKIP_ROUND,          // Skip to next round without winner
        RANDOM_FROM_ALL,     // Select random seed from all eligible (ignoring scores)
        ALLOW_REWINS         // Allow previously won seeds to win again
    }

    /// @notice Role for backend relayer that can submit blessings on behalf of users
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    /// @notice Role for admin functions (replaces Ownable)
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;

    /// @notice Role for authorized seed creators
    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");

    /// @notice Contract version for tracking upgrades
    string public constant VERSION = "1.2.0";

    /// @notice Maximum seeds that can be submitted per round (prevents gas bombs)
    uint256 public constant MAX_SEEDS_PER_ROUND = 1000;

    /// @notice Maximum total seeds ever submitted (prevents unbounded array growth)
    uint256 public constant MAX_TOTAL_SEEDS = 100000;

    /// @notice Scale factor for score precision (applied before sqrt)
    uint256 public constant SCORE_SCALE_FACTOR = 1e6;

    /// @notice Duration of each voting period (default: 24 hours, configurable)
    uint256 public votingPeriod;

    /// @notice Next voting period (deferred update, applies after current round ends)
    uint256 public nextVotingPeriod;

    /// @notice Current Merkle root of FirstWorks NFT ownership (updated daily)
    bytes32 public currentOwnershipRoot;

    /// @notice Timestamp when ownership root was last updated
    uint256 public rootTimestamp;

    /// @notice Start time of the current voting period
    uint256 public currentVotingPeriodStart;

    /// @notice Total number of Seeds submitted (includes retracted seeds)
    uint256 public seedCount;

    /// @notice Current voting round number
    uint256 public currentRound;

    /// @notice Contract pause state
    bool public paused;

    /// @notice Reason for pause (helps with transparency)
    string public pauseReason;

    /// @notice Total blessings count across all seeds
    uint256 public totalBlessingsCount;

    /// @notice How many blessings each NFT grants per day (default: 1, configurable)
    uint256 public blessingsPerNFT;

    /// @notice Next blessings per NFT value (deferred update)
    uint256 public nextBlessingsPerNFT;

    /// @notice Whether to reset scores at the end of each round
    bool public resetScoresOnRoundEnd;

    /// @notice Track user's blessing count per day: user => day => count
    /// @dev Day is calculated as block.timestamp / 1 days
    mapping(address => mapping(uint256 => uint256)) public userDailyBlessings;

    /// @notice Current round mode (ROUND_BASED or NON_ROUND_BASED)
    RoundMode public roundMode;

    /// @notice Current tie-breaking strategy
    TieBreakingStrategy public tieBreakingStrategy;

    /// @notice Current deadlock handling strategy
    DeadlockStrategy public deadlockStrategy;

    /// @notice Array of all seed IDs for non-round-based selection
    /// @dev Used when roundMode is NON_ROUND_BASED to query all seeds efficiently
    uint256[] public allSeedIds;

    /// @notice Array of seed IDs that are still eligible to win (not winners, not retracted)
    /// @dev Used in NON_ROUND_BASED mode for efficient winner selection (O(eligible) instead of O(all))
    uint256[] public eligibleSeedIds;

    /// @notice Mapping to track position in eligibleSeedIds array for O(1) removal
    /// @dev Maps seedId => index in eligibleSeedIds array
    mapping(uint256 => uint256) private eligibleSeedIndex;

    /// @notice Track if seed is currently in eligible array
    /// @dev Used to prevent duplicate adds and enable quick eligibility checks
    mapping(uint256 => bool) private isInEligibleArray;

    struct Seed {
        uint256 id;
        address creator;
        string ipfsHash;        // IPFS hash of the artwork (contains all metadata)
        uint256 blessings;      // Total blessings received (used for winner selection with sqrt + time decay)
        uint256 createdAt;
        bool isWinner;          // True when selected as winner
        bool isRetracted;       // True when creator retracts the seed (separate from isWinner)
        uint256 winnerInRound;  // Round number when selected as winner
        uint256 submittedInRound; // Round number when seed was submitted (for round-based competition)
    }

    struct Blessing {
        uint256 seedId;
        address blesser;        // User who gave the blessing (may be different from actor if delegated)
        address actor;          // Account that executed the blessing (relayer or blesser)
        uint256 timestamp;
        bool isDelegated;       // True if blessing was submitted by a delegate/relayer
    }

    /// @notice Mapping of seed ID to Seed data
    mapping(uint256 => Seed) public seeds;

    /// @notice Mapping of round => winning seed ID
    mapping(uint256 => uint256) public roundWinners;

    /// @notice Mapping of round => array of seed IDs submitted in that round
    /// @dev Used for efficient winner selection (only loop through current round's seeds)
    mapping(uint256 => uint256[]) public roundSeedIds;

    /// @notice Delegation: user => delegate => approved
    /// @dev Users can approve delegates (e.g., backend server, smart wallets) to bless on their behalf
    mapping(address => mapping(address => bool)) public isDelegateApproved;

    /// @notice Track blessing count per user per seed (allows multiple blessings)
    mapping(address => mapping(uint256 => uint256)) public userSeedBlessingCount;

    /// @notice Track sqrt-adjusted blessing score per seed (sum of sqrt of each user's blessings)
    /// @dev Score is updated incrementally as blessings come in, not calculated at winner selection
    mapping(uint256 => uint256) public seedBlessingScore;

    /// @notice Per-round score tracking for score reset functionality
    /// @dev Maps round => seedId => score. Used when resetScoresOnRoundEnd = true
    mapping(uint256 => mapping(uint256 => uint256)) public seedScoreByRound;

    /// @notice Per-round blessing count tracking for score reset functionality
    /// @dev Maps round => user => seedId => count. Used when resetScoresOnRoundEnd = true
    mapping(uint256 => mapping(address => mapping(uint256 => uint256))) public userSeedBlessingsByRound;

    /// @notice Array of all blessings for tracking and querying
    Blessing[] public allBlessings;

    /// @notice Mapping of seed ID to array of blessing indices
    mapping(uint256 => uint256[]) public seedBlessings;

    /// @notice Mapping of user address to array of blessing indices
    mapping(address => uint256[]) public userBlessings;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event OwnershipRootUpdated(
        bytes32 indexed newRoot,
        uint256 timestamp,
        uint256 blockNumber
    );

    event SeedSubmitted(
        uint256 indexed seedId,
        address indexed creator,
        string ipfsHash,
        string title,
        uint256 timestamp
    );

    event WinnerSelected(
        uint256 indexed round,
        uint256 indexed seedId,
        string ipfsHash,
        uint256 blessings,
        uint256 score,
        bytes32 seedProof
    );

    event BlessingPeriodStarted(uint256 indexed round, uint256 startTime);

    event SeedRetracted(uint256 indexed seedId, address indexed creator);

    event ContractPaused(address indexed by);

    event ContractUnpaused(address indexed by);

    event DelegateApproval(
        address indexed user,
        address indexed delegate,
        bool approved
    );

    event BlessingSubmitted(
        uint256 indexed seedId,
        address indexed blesser,
        address indexed actor,
        bool isDelegated,
        uint256 timestamp
    );

    event RelayerAdded(address indexed relayer, address indexed addedBy);

    event RelayerRemoved(address indexed relayer, address indexed removedBy);

    event CreatorAdded(address indexed creator, address indexed addedBy);

    event CreatorRemoved(address indexed creator, address indexed removedBy);

    event VotingPeriodUpdated(uint256 previousPeriod, uint256 newPeriod);

    event BlessingsPerNFTUpdated(uint256 previousAmount, uint256 newAmount);

    event RoundModeUpdated(RoundMode previousMode, RoundMode newMode);

    event TieBreakingStrategyUpdated(TieBreakingStrategy previousStrategy, TieBreakingStrategy newStrategy);

    event DeadlockStrategyUpdated(DeadlockStrategy previousStrategy, DeadlockStrategy newStrategy);

    event RoundSkipped(uint256 indexed round, uint256 timestamp, string reason);

    event SeedScoreUpdated(
        uint256 indexed seedId,
        address indexed blesser,
        uint256 previousScore,
        uint256 newScore,
        uint256 decayFactor
    );

    event BlessingFailed(
        uint256 indexed seedId,
        address indexed blesser,
        string reason
    );

    event VotingPeriodScheduled(uint256 currentPeriod, uint256 scheduledPeriod);

    event BlessingsPerNFTScheduled(uint256 currentAmount, uint256 scheduledAmount);

    event ScoreResetPolicyUpdated(bool resetScores);

    event ScoresReset(uint256 indexed round, uint256 seedsAffected);

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

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
    error MustProvideNFTProof();
    error InvalidVotingPeriod();
    error InvalidBlessingsPerNFT();
    error MaxSeedsReached();
    error RoundSeedLimitReached();
    error AlreadyRetracted();
    error InvalidIPFSHash();
    error DuplicateTokenIds();

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _admin, address _initialCreator) {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);

        // Grant creator role to initial creator (can be zero address if not needed)
        if (_initialCreator != address(0)) {
            _grantRole(CREATOR_ROLE, _initialCreator);
            emit CreatorAdded(_initialCreator, _admin);
        }

        // Initialize with default values
        votingPeriod = 1 days;
        blessingsPerNFT = 1;
        nextVotingPeriod = 0; // No deferred update
        nextBlessingsPerNFT = 0; // No deferred update
        resetScoresOnRoundEnd = false; // Don't reset scores by default

        currentVotingPeriodStart = block.timestamp;
        currentRound = 1;

        // Initialize with backward-compatible defaults
        roundMode = RoundMode.ROUND_BASED;              // Traditional round-based selection
        tieBreakingStrategy = TieBreakingStrategy.LOWEST_SEED_ID;  // Deterministic tie-breaking
        deadlockStrategy = DeadlockStrategy.REVERT;     // Revert on no eligible seeds

        emit BlessingPeriodStarted(1, block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                          MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                          SEED SUBMISSION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Submit a new Seed (artwork proposal)
     * @dev Only addresses with CREATOR_ROLE can submit seeds
     * @param _ipfsHash IPFS hash of the artwork metadata (contains title, description, image, etc.)
     * @return seedId The ID of the newly created Seed
     */
    function submitSeed(
        string memory _ipfsHash
    ) external whenNotPaused onlyRole(CREATOR_ROLE) returns (uint256) {
        // Validate IPFS hash
        _validateIPFSHash(_ipfsHash);

        // Prevent unbounded growth
        if (seedCount >= MAX_TOTAL_SEEDS) {
            revert MaxSeedsReached();
        }

        // Prevent per-round gas bombs
        if (roundSeedIds[currentRound].length >= MAX_SEEDS_PER_ROUND) {
            revert RoundSeedLimitReached();
        }

        uint256 seedId = seedCount;
        seedCount++;

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

        // Add seed to current round's seed list for efficient lookup
        roundSeedIds[currentRound].push(seedId);

        // Add seed to global list for non-round-based selection
        allSeedIds.push(seedId);

        // Add seed to eligible seeds array for efficient winner selection
        eligibleSeedIds.push(seedId);
        eligibleSeedIndex[seedId] = eligibleSeedIds.length - 1;
        isInEligibleArray[seedId] = true;

        emit SeedSubmitted(seedId, msg.sender, _ipfsHash, "", block.timestamp);

        return seedId;
    }

    /**
     * @notice Retract a submitted Seed (only by creator, before becoming winner)
     * @dev Retracted seeds cannot receive blessings or be selected as winners
     * @param _seedId ID of the Seed to retract
     */
    function retractSeed(uint256 _seedId) external {
        Seed storage seed = seeds[_seedId];

        if (seed.createdAt == 0) revert SeedNotFound();
        if (seed.creator != msg.sender) revert NotSeedCreator();
        if (seed.isWinner) revert CannotRetractWinningSeed();
        if (seed.isRetracted) revert AlreadyRetracted();

        // Mark as retracted to prevent further blessings and voting
        seed.isRetracted = true;

        // Remove from eligible seeds array
        _removeFromEligibleSeeds(_seedId);

        emit SeedRetracted(_seedId, msg.sender);
    }

    /*//////////////////////////////////////////////////////////////
                          BLESSING FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Approve or revoke a delegate's permission to bless on your behalf
     * @param _delegate Address of the delegate (e.g., backend server, smart wallet)
     * @param _approved True to approve, false to revoke
     * @dev Common use case: Approve backend server to submit blessings after off-chain verification
     */
    function approveDelegate(address _delegate, bool _approved) external {
        if (_delegate == address(0)) revert InvalidBlesser();

        isDelegateApproved[msg.sender][_delegate] = _approved;
        emit DelegateApproval(msg.sender, _delegate, _approved);
    }

    /**
     * @notice Directly bless a seed with NFT ownership verification
     * @param _seedId ID of the seed to bless
     * @param _tokenIds Array of FirstWorks token IDs owned (determines max daily blessings)
     * @param _merkleProof Merkle proof of NFT ownership
     * @dev User calls this directly to bless a seed. NFT ownership is verified on-chain.
     */
    function blessSeed(
        uint256 _seedId,
        uint256[] memory _tokenIds,
        bytes32[] memory _merkleProof
    ) external whenNotPaused nonReentrant {
        // Verify NFT ownership
        if (!_verifyOwnership(msg.sender, _tokenIds, _merkleProof)) {
            revert InvalidMerkleProof();
        }

        if (_tokenIds.length == 0) revert NoVotingPower();

        // Check daily blessing limit
        _checkAndUpdateDailyLimit(msg.sender, _tokenIds.length);

        _processBless(_seedId, msg.sender, msg.sender, false);
    }

    /**
     * @notice Bless a seed on behalf of a user (for relayers/delegates)
     * @param _seedId ID of the seed to bless
     * @param _blesser Address of the user giving the blessing
     * @param _tokenIds Array of FirstWorks token IDs owned by the blesser
     * @param _merkleProof Merkle proof of NFT ownership
     * @dev Only callable by approved delegates or relayers
     * @dev Backend server must provide NFT proof - eligibility is verified on-chain
     */
    function blessSeedFor(
        uint256 _seedId,
        address _blesser,
        uint256[] memory _tokenIds,
        bytes32[] memory _merkleProof
    ) external whenNotPaused nonReentrant {
        if (_blesser == address(0)) revert InvalidBlesser();

        // Check authorization: must be either an approved delegate or have RELAYER_ROLE
        bool isApprovedDelegate = isDelegateApproved[_blesser][msg.sender];
        bool isRelayer = hasRole(RELAYER_ROLE, msg.sender);

        if (!isApprovedDelegate && !isRelayer) {
            revert NotAuthorized();
        }

        // Verify NFT ownership
        if (!_verifyOwnership(_blesser, _tokenIds, _merkleProof)) {
            revert InvalidMerkleProof();
        }

        if (_tokenIds.length == 0) revert NoVotingPower();

        // Check daily blessing limit
        _checkAndUpdateDailyLimit(_blesser, _tokenIds.length);

        _processBless(_seedId, _blesser, msg.sender, true);
    }

    /**
     * @notice Batch bless multiple seeds on behalf of users (for relayers)
     * @param _seedIds Array of seed IDs to bless
     * @param _blessers Array of user addresses giving blessings
     * @param _tokenIdsArray Array of token ID arrays for each blesser
     * @param _merkleProofs Array of Merkle proofs for each blesser
     * @dev Only callable by relayers. All arrays must be same length.
     * @dev Useful for batch processing verified blessings from backend
     */
    function batchBlessSeedsFor(
        uint256[] calldata _seedIds,
        address[] calldata _blessers,
        uint256[][] calldata _tokenIdsArray,
        bytes32[][] calldata _merkleProofs
    ) external whenNotPaused nonReentrant onlyRole(RELAYER_ROLE) {
        if (
            _seedIds.length != _blessers.length ||
            _seedIds.length != _tokenIdsArray.length ||
            _seedIds.length != _merkleProofs.length ||
            _seedIds.length == 0
        ) {
            revert InvalidSeedData();
        }

        for (uint256 i = 0; i < _seedIds.length; i++) {
            if (_blessers[i] == address(0)) {
                emit BlessingFailed(_seedIds[i], _blessers[i], "Invalid blesser address");
                continue;
            }

            // Verify NFT ownership
            if (!_verifyOwnership(_blessers[i], _tokenIdsArray[i], _merkleProofs[i])) {
                emit BlessingFailed(_seedIds[i], _blessers[i], "Invalid Merkle proof");
                continue;
            }

            if (_tokenIdsArray[i].length == 0) {
                emit BlessingFailed(_seedIds[i], _blessers[i], "No NFTs provided");
                continue;
            }

            // Check daily blessing limit (skip if limit reached)
            uint256 currentDay = block.timestamp / 1 days;
            uint256 maxBlessings = _tokenIdsArray[i].length * blessingsPerNFT;
            if (userDailyBlessings[_blessers[i]][currentDay] >= maxBlessings) {
                emit BlessingFailed(_seedIds[i], _blessers[i], "Daily blessing limit reached");
                continue;
            }

            userDailyBlessings[_blessers[i]][currentDay]++;
            _processBless(_seedIds[i], _blessers[i], msg.sender, true);
        }
    }

    /**
     * @dev Check if user has reached daily blessing limit and update counter
     * @param _user User address
     * @param _nftCount Number of NFTs owned (determines max blessings)
     */
    function _checkAndUpdateDailyLimit(address _user, uint256 _nftCount) internal {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxBlessings = _nftCount * blessingsPerNFT;
        uint256 currentBlessings = userDailyBlessings[_user][currentDay];

        if (currentBlessings >= maxBlessings) {
            revert DailyBlessingLimitReached();
        }

        userDailyBlessings[_user][currentDay]++;
    }

    /**
     * @dev Internal function to process a blessing
     * @param _seedId Seed being blessed
     * @param _blesser User giving the blessing
     * @param _actor Account executing the blessing
     * @param _isDelegated Whether this was submitted by a delegate/relayer
     */
    function _processBless(
        uint256 _seedId,
        address _blesser,
        address _actor,
        bool _isDelegated
    ) internal {
        Seed storage seed = seeds[_seedId];

        // Validate seed
        if (seed.createdAt == 0) revert SeedNotFound();
        if (seed.isWinner) revert SeedAlreadyWinner();
        if (seed.isRetracted) revert SeedAlreadyWinner(); // Treat retracted same as winner for blessings

        // Prevent blessings after the voting period has ended
        if (block.timestamp >= currentVotingPeriodStart + votingPeriod) {
            revert BlessingPeriodEnded();
        }

        // Update all-time blessing counts
        uint256 previousCount = userSeedBlessingCount[_blesser][_seedId];
        userSeedBlessingCount[_blesser][_seedId] = previousCount + 1;
        seed.blessings++;

        // Update per-round blessing counts (for score reset feature)
        uint256 previousCountRound = userSeedBlessingsByRound[currentRound][_blesser][_seedId];
        userSeedBlessingsByRound[currentRound][_blesser][_seedId] = previousCountRound + 1;

        // Calculate and apply score updates (both all-time and per-round)
        _updateBlessingScores(_seedId, _blesser, previousCount, previousCountRound);

        // Store blessing record
        allBlessings.push(Blessing({
            seedId: _seedId,
            blesser: _blesser,
            actor: _actor,
            timestamp: block.timestamp,
            isDelegated: _isDelegated
        }));

        // Index by seed and user
        seedBlessings[_seedId].push(allBlessings.length - 1);
        userBlessings[_blesser].push(allBlessings.length - 1);
        totalBlessingsCount++;

        emit BlessingSubmitted(_seedId, _blesser, _actor, _isDelegated, block.timestamp);
    }

    /**
     * @dev Update blessing scores for both all-time and per-round tracking
     * @param _seedId Seed being blessed
     * @param _blesser User giving the blessing
     * @param _previousCount Previous all-time blessing count
     * @param _previousCountRound Previous per-round blessing count
     */
    function _updateBlessingScores(
        uint256 _seedId,
        address _blesser,
        uint256 _previousCount,
        uint256 _previousCountRound
    ) internal {
        // Calculate decay factor (same for both scores)
        uint256 timeRemaining = (currentVotingPeriodStart + votingPeriod) - block.timestamp;
        uint256 decayFactor = _calculateBlessingTimeDecay(timeRemaining);

        // Update all-time score
        uint256 oldScore = _updateAllTimeScore(_seedId, _previousCount, decayFactor);

        // Update per-round score
        _updateRoundScore(_seedId, _previousCountRound, decayFactor);

        emit SeedScoreUpdated(_seedId, _blesser, oldScore, seedBlessingScore[_seedId], decayFactor);
    }

    /**
     * @dev Update all-time blessing score for a seed
     * @param _seedId Seed being blessed
     * @param _previousCount Previous blessing count
     * @param _decayFactor Time decay factor
     * @return oldScore The score before update
     */
    function _updateAllTimeScore(
        uint256 _seedId,
        uint256 _previousCount,
        uint256 _decayFactor
    ) internal returns (uint256 oldScore) {
        uint256 previousScore = _previousCount > 0 ? sqrt(_previousCount * SCORE_SCALE_FACTOR) : 0;
        uint256 newScore = sqrt((_previousCount + 1) * SCORE_SCALE_FACTOR);
        uint256 scoreDelta = ((newScore - previousScore) * _decayFactor) / 1000;

        oldScore = seedBlessingScore[_seedId];
        seedBlessingScore[_seedId] = oldScore + scoreDelta;
    }

    /**
     * @dev Update per-round blessing score for a seed
     * @param _seedId Seed being blessed
     * @param _previousCountRound Previous round blessing count
     * @param _decayFactor Time decay factor
     */
    function _updateRoundScore(
        uint256 _seedId,
        uint256 _previousCountRound,
        uint256 _decayFactor
    ) internal {
        uint256 previousScoreRound = _previousCountRound > 0 ? sqrt(_previousCountRound * SCORE_SCALE_FACTOR) : 0;
        uint256 newScoreRound = sqrt((_previousCountRound + 1) * SCORE_SCALE_FACTOR);
        uint256 scoreDeltaRound = ((newScoreRound - previousScoreRound) * _decayFactor) / 1000;

        uint256 oldScoreRound = seedScoreByRound[currentRound][_seedId];
        seedScoreByRound[currentRound][_seedId] = oldScoreRound + scoreDeltaRound;
    }

    /*//////////////////////////////////////////////////////////////
                          WINNER SELECTION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Select the winning Seed for the current period based on blessings
     * @dev Winner determined by: sqrt(sum of each user's blessings) * time_decay
     * @dev Supports multiple round modes and configurable tie-breaking/deadlock handling
     * @dev Can be called by anyone after blessing period ends
     * @return winningSeedId The ID of the winning Seed
     */
    function selectDailyWinner() external whenNotPaused nonReentrant returns (uint256) {
        if (block.timestamp < currentVotingPeriodStart + votingPeriod) {
            revert VotingPeriodNotEnded();
        }

        // Get candidate seeds based on round mode
        uint256[] memory candidateSeedIds = _getCandidateSeeds();

        // Find all seeds with maximum score
        (uint256[] memory topSeedIds, uint256 maxScore) = _findTopSeeds(candidateSeedIds);

        // Handle no eligible seeds case (deadlock)
        if (topSeedIds.length == 0) {
            return _handleDeadlock();
        }

        // Apply tie-breaking if multiple seeds have same score
        uint256 winningSeedId;
        if (topSeedIds.length == 1) {
            winningSeedId = topSeedIds[0];
        } else {
            winningSeedId = _applyTieBreaking(topSeedIds);
        }

        // Mark as winner and record round
        Seed storage winningSeed = seeds[winningSeedId];
        winningSeed.isWinner = true;
        winningSeed.winnerInRound = currentRound;
        roundWinners[currentRound] = winningSeedId;

        // Remove winner from eligible seeds array
        _removeFromEligibleSeeds(winningSeedId);

        // Generate proof for L1 verification
        bytes32 seedProof = keccak256(
            abi.encodePacked(
                winningSeedId,
                winningSeed.ipfsHash,
                winningSeed.blessings,
                currentRound,
                block.timestamp
            )
        );

        // Apply deferred configuration updates (before starting new round)
        _applyDeferredConfigUpdates();

        // NOTE: Score reset is automatic via per-round tracking
        // When currentRound increments, seedScoreByRound[newRound][seedId] starts at 0

        // Start new blessing period
        currentRound++;
        currentVotingPeriodStart = block.timestamp;

        emit WinnerSelected(
            currentRound - 1,
            winningSeedId,
            winningSeed.ipfsHash,
            winningSeed.blessings,
            maxScore,
            seedProof
        );
        emit BlessingPeriodStarted(currentRound, block.timestamp);

        return winningSeedId;
    }

    /**
     * @dev Get candidate seeds based on current round mode
     * @return Array of seed IDs to consider for winner selection
     */
    function _getCandidateSeeds() internal view returns (uint256[] memory) {
        if (roundMode == RoundMode.ROUND_BASED) {
            // Traditional: only seeds from current round
            return roundSeedIds[currentRound];
        } else {
            // Non-round-based: only eligible seeds (not winners, not retracted)
            // OPTIMIZATION: Uses eligibleSeedIds instead of allSeedIds for massive gas savings
            // Reduces iterations from O(100k) to O(eligible) typically <1k
            return eligibleSeedIds;
        }
    }

    /**
     * @dev Find all seeds with the maximum score
     * @param candidateSeedIds Array of seed IDs to evaluate
     * @return topSeedIds Array of seed IDs with max score
     * @return maxScore The maximum score found
     */
    function _findTopSeeds(
        uint256[] memory candidateSeedIds
    ) internal view returns (uint256[] memory topSeedIds, uint256 maxScore) {
        uint256 maxScore_ = 0;
        uint256 topCount = 0;

        // Determine which score to use based on reset policy
        // If reset is enabled, use per-round scores; otherwise use all-time scores
        bool useRoundScores = resetScoresOnRoundEnd;

        // First pass: find max score and count how many seeds have it
        for (uint256 i = 0; i < candidateSeedIds.length; i++) {
            uint256 seedId = candidateSeedIds[i];

            // Filter out retracted seeds (always excluded)
            if (seeds[seedId].isRetracted) {
                continue;
            }

            // Only consider seeds that haven't won yet (unless ALLOW_REWINS)
            if (deadlockStrategy != DeadlockStrategy.ALLOW_REWINS && seeds[seedId].isWinner) {
                continue;
            }

            // Get score from appropriate source
            uint256 score = useRoundScores
                ? seedScoreByRound[currentRound][seedId]
                : seedBlessingScore[seedId];

            if (score > maxScore_) {
                maxScore_ = score;
                topCount = 1;
            } else if (score == maxScore_ && score > 0) {
                topCount++;
            }
        }

        // No eligible seeds found
        if (topCount == 0) {
            return (new uint256[](0), 0);
        }

        // Second pass: collect all seeds with max score
        uint256[] memory topSeeds = new uint256[](topCount);
        uint256 index = 0;

        for (uint256 i = 0; i < candidateSeedIds.length; i++) {
            uint256 seedId = candidateSeedIds[i];

            // Apply same filters as first pass
            if (seeds[seedId].isRetracted) {
                continue;
            }

            if (deadlockStrategy != DeadlockStrategy.ALLOW_REWINS && seeds[seedId].isWinner) {
                continue;
            }

            // Get score from appropriate source
            uint256 score = useRoundScores
                ? seedScoreByRound[currentRound][seedId]
                : seedBlessingScore[seedId];

            if (score == maxScore_) {
                topSeeds[index] = seedId;
                index++;
            }
        }

        return (topSeeds, maxScore_);
    }

    /**
     * @dev Apply tie-breaking strategy to select winner from multiple tied seeds
     * @param tiedSeedIds Array of seed IDs with same score
     * @return winningSeedId The selected winner
     */
    function _applyTieBreaking(uint256[] memory tiedSeedIds) internal view returns (uint256) {
        if (tiedSeedIds.length == 0) revert NoValidWinner();
        if (tiedSeedIds.length == 1) return tiedSeedIds[0];

        if (tieBreakingStrategy == TieBreakingStrategy.LOWEST_SEED_ID) {
            // Find lowest seed ID
            uint256 lowestId = tiedSeedIds[0];
            for (uint256 i = 1; i < tiedSeedIds.length; i++) {
                if (tiedSeedIds[i] < lowestId) {
                    lowestId = tiedSeedIds[i];
                }
            }
            return lowestId;

        } else if (tieBreakingStrategy == TieBreakingStrategy.HIGHEST_SEED_ID) {
            // Find highest seed ID
            uint256 highestId = tiedSeedIds[0];
            for (uint256 i = 1; i < tiedSeedIds.length; i++) {
                if (tiedSeedIds[i] > highestId) {
                    highestId = tiedSeedIds[i];
                }
            }
            return highestId;

        } else if (tieBreakingStrategy == TieBreakingStrategy.EARLIEST_SUBMISSION) {
            // Find earliest timestamp
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

        } else if (tieBreakingStrategy == TieBreakingStrategy.LATEST_SUBMISSION) {
            // Find latest timestamp
            uint256 selectedId = tiedSeedIds[0];
            uint256 latestTime = seeds[tiedSeedIds[0]].createdAt;

            for (uint256 i = 1; i < tiedSeedIds.length; i++) {
                uint256 seedTime = seeds[tiedSeedIds[i]].createdAt;
                if (seedTime > latestTime) {
                    latestTime = seedTime;
                    selectedId = tiedSeedIds[i];
                }
            }
            return selectedId;

        } else if (tieBreakingStrategy == TieBreakingStrategy.PSEUDO_RANDOM) {
            // Pseudo-random selection using block data
            // WARNING: Miners can influence this, use only when stakes are low
            uint256 randomIndex = uint256(
                keccak256(abi.encodePacked(
                    block.timestamp,
                    block.prevrandao,
                    blockhash(block.number - 1),
                    tiedSeedIds.length
                ))
            ) % tiedSeedIds.length;

            return tiedSeedIds[randomIndex];
        }

        // Fallback to lowest ID
        return tiedSeedIds[0];
    }

    /**
     * @dev Handle deadlock scenario when no eligible seeds are available
     * @return winningSeedId The selected winner (0 if round skipped)
     */
    function _handleDeadlock() internal returns (uint256) {
        if (deadlockStrategy == DeadlockStrategy.REVERT) {
            // Traditional behavior: revert transaction
            revert NoValidWinner();

        } else if (deadlockStrategy == DeadlockStrategy.SKIP_ROUND) {
            // Skip this round without selecting a winner
            uint256 skippedRound = currentRound;

            // Apply deferred configuration updates before starting new round
            _applyDeferredConfigUpdates();

            // Start new round
            currentRound++;
            currentVotingPeriodStart = block.timestamp;

            emit RoundSkipped(skippedRound, block.timestamp, "No eligible seeds");
            emit BlessingPeriodStarted(currentRound, block.timestamp);

            return 0; // No winner

        } else if (deadlockStrategy == DeadlockStrategy.RANDOM_FROM_ALL) {
            // Select a random seed from all eligible seeds, ignoring scores
            uint256[] memory candidateSeedIds = _getCandidateSeeds();

            // Collect all eligible seeds (not winners and not retracted)
            uint256 eligibleCount = 0;
            for (uint256 i = 0; i < candidateSeedIds.length; i++) {
                if (!seeds[candidateSeedIds[i]].isWinner && !seeds[candidateSeedIds[i]].isRetracted) {
                    eligibleCount++;
                }
            }

            if (eligibleCount == 0) {
                // Still no eligible seeds, revert
                revert NoValidWinner();
            }

            uint256[] memory eligibleSeeds = new uint256[](eligibleCount);
            uint256 index = 0;
            for (uint256 i = 0; i < candidateSeedIds.length; i++) {
                if (!seeds[candidateSeedIds[i]].isWinner && !seeds[candidateSeedIds[i]].isRetracted) {
                    eligibleSeeds[index] = candidateSeedIds[i];
                    index++;
                }
            }

            // Select random seed
            uint256 randomIndex = uint256(
                keccak256(abi.encodePacked(
                    block.timestamp,
                    block.prevrandao,
                    blockhash(block.number - 1),
                    eligibleCount
                ))
            ) % eligibleCount;

            uint256 winningSeedId = eligibleSeeds[randomIndex];

            // Mark as winner
            Seed storage winningSeed = seeds[winningSeedId];
            winningSeed.isWinner = true;
            winningSeed.winnerInRound = currentRound;
            roundWinners[currentRound] = winningSeedId;

            // Remove winner from eligible seeds array
            _removeFromEligibleSeeds(winningSeedId);

            // Generate proof
            bytes32 seedProof = keccak256(
                abi.encodePacked(
                    winningSeedId,
                    winningSeed.ipfsHash,
                    winningSeed.blessings,
                    currentRound,
                    block.timestamp
                )
            );

            // Apply deferred configuration updates before starting new round
            _applyDeferredConfigUpdates();

            // Start new round
            currentRound++;
            currentVotingPeriodStart = block.timestamp;

            emit WinnerSelected(
                currentRound - 1,
                winningSeedId,
                winningSeed.ipfsHash,
                winningSeed.blessings,
                0, // No score in random selection
                seedProof
            );
            emit BlessingPeriodStarted(currentRound, block.timestamp);

            return winningSeedId;

        } else if (deadlockStrategy == DeadlockStrategy.ALLOW_REWINS) {
            // This is handled in _findTopSeeds by including previous winners
            // If we still get here, it means truly no seeds exist
            revert NoValidWinner();
        }

        // Fallback: revert
        revert NoValidWinner();
    }

    /*//////////////////////////////////////////////////////////////
                          ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Add a relayer (backend server) that can submit blessings on behalf of users
     * @param _relayer Address of the relayer
     */
    function addRelayer(address _relayer) external onlyRole(ADMIN_ROLE) {
        grantRole(RELAYER_ROLE, _relayer);
        emit RelayerAdded(_relayer, msg.sender);
    }

    /**
     * @notice Remove a relayer
     * @param _relayer Address of the relayer to remove
     */
    function removeRelayer(address _relayer) external onlyRole(ADMIN_ROLE) {
        revokeRole(RELAYER_ROLE, _relayer);
        emit RelayerRemoved(_relayer, msg.sender);
    }

    /**
     * @notice Add a seed creator (authorized wallet that can create seeds)
     * @param _creator Address of the creator
     */
    function addCreator(address _creator) external onlyRole(ADMIN_ROLE) {
        grantRole(CREATOR_ROLE, _creator);
        emit CreatorAdded(_creator, msg.sender);
    }

    /**
     * @notice Remove a seed creator
     * @param _creator Address of the creator to remove
     */
    function removeCreator(address _creator) external onlyRole(ADMIN_ROLE) {
        revokeRole(CREATOR_ROLE, _creator);
        emit CreatorRemoved(_creator, msg.sender);
    }

    /**
     * @notice Update the Merkle root of FirstWorks ownership
     * @dev Called by admin after generating new snapshot
     * @param _newRoot New Merkle root hash
     */
    function updateOwnershipRoot(bytes32 _newRoot) external onlyRole(ADMIN_ROLE) {
        if (_newRoot == bytes32(0)) revert InvalidOwnershipRoot();

        currentOwnershipRoot = _newRoot;
        rootTimestamp = block.timestamp;

        emit OwnershipRootUpdated(_newRoot, block.timestamp, block.number);
    }

    /**
     * @notice Pause the contract with a reason
     * @param reason Explanation for the pause
     */
    function pause(string calldata reason) external onlyRole(ADMIN_ROLE) {
        paused = true;
        pauseReason = reason;
        emit ContractPaused(msg.sender);
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        paused = false;
        pauseReason = "";
        emit ContractUnpaused(msg.sender);
    }

    /**
     * @notice Schedule a voting period update (takes effect after current round ends)
     * @dev Can only be called by admin
     * @dev Deferred update prevents mid-round configuration changes
     * @dev Must be at least 1 hour and at most 7 days
     * @param _newVotingPeriod New voting period duration in seconds
     */
    function updateVotingPeriod(uint256 _newVotingPeriod) external onlyRole(ADMIN_ROLE) {
        if (_newVotingPeriod < 1 hours || _newVotingPeriod > 7 days) {
            revert InvalidVotingPeriod();
        }

        nextVotingPeriod = _newVotingPeriod;
        emit VotingPeriodScheduled(votingPeriod, _newVotingPeriod);
    }

    /**
     * @notice Schedule a blessings per NFT update (takes effect after current round ends)
     * @dev Can only be called by admin
     * @dev Deferred update prevents mid-round configuration changes
     * @dev Must be at least 1 and at most 100
     * @param _newBlessingsPerNFT New blessings per NFT amount
     */
    function updateBlessingsPerNFT(uint256 _newBlessingsPerNFT) external onlyRole(ADMIN_ROLE) {
        if (_newBlessingsPerNFT == 0 || _newBlessingsPerNFT > 100) {
            revert InvalidBlessingsPerNFT();
        }

        nextBlessingsPerNFT = _newBlessingsPerNFT;
        emit BlessingsPerNFTScheduled(blessingsPerNFT, _newBlessingsPerNFT);
    }

    /**
     * @notice Update the score reset policy
     * @dev Can only be called by admin
     * @dev Takes effect on next winner selection
     * @param _enabled True to reset scores at end of each round, false to keep accumulating
     */
    function updateScoreResetPolicy(bool _enabled) external onlyRole(ADMIN_ROLE) {
        resetScoresOnRoundEnd = _enabled;
        emit ScoreResetPolicyUpdated(_enabled);
    }

    /**
     * @notice Update the round mode (ROUND_BASED or NON_ROUND_BASED)
     * @dev Can only be called by admin
     * @dev Takes effect on next winner selection
     * @param _newRoundMode New round mode
     */
    function updateRoundMode(RoundMode _newRoundMode) external onlyRole(ADMIN_ROLE) {
        RoundMode previousMode = roundMode;
        roundMode = _newRoundMode;

        emit RoundModeUpdated(previousMode, _newRoundMode);
    }

    /**
     * @notice Update the tie-breaking strategy
     * @dev Can only be called by admin
     * @dev Takes effect on next winner selection
     * @param _newStrategy New tie-breaking strategy
     */
    function updateTieBreakingStrategy(TieBreakingStrategy _newStrategy) external onlyRole(ADMIN_ROLE) {
        TieBreakingStrategy previousStrategy = tieBreakingStrategy;
        tieBreakingStrategy = _newStrategy;

        emit TieBreakingStrategyUpdated(previousStrategy, _newStrategy);
    }

    /**
     * @notice Update the deadlock handling strategy
     * @dev Can only be called by admin
     * @dev Takes effect on next winner selection
     * @dev WARNING: ALLOW_REWINS allows seeds to win multiple times
     * @param _newStrategy New deadlock strategy
     */
    function updateDeadlockStrategy(DeadlockStrategy _newStrategy) external onlyRole(ADMIN_ROLE) {
        DeadlockStrategy previousStrategy = deadlockStrategy;
        deadlockStrategy = _newStrategy;

        emit DeadlockStrategyUpdated(previousStrategy, _newStrategy);
    }

    /*//////////////////////////////////////////////////////////////
                          VIEW FUNCTIONS - SEEDS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Get details about a Seed
     * @param _seedId ID of the Seed
     * @return Seed struct data
     */
    function getSeed(uint256 _seedId) external view returns (Seed memory) {
        if (_seedId >= seedCount) revert SeedNotFound();
        return seeds[_seedId];
    }

    /**
     * @notice Get current leader from eligible seeds based on blessing score
     * @dev If multiple seeds are tied, returns the one that would win based on tie-breaking strategy
     * @return leadingSeedId ID of the Seed with highest score (after tie-breaking)
     * @return score Score (sqrt-adjusted blessings with time decay already applied)
     */
    function getCurrentLeader() external view returns (uint256 leadingSeedId, uint256 score) {
        uint256[] memory candidateSeeds = roundMode == RoundMode.ROUND_BASED
            ? roundSeedIds[currentRound]
            : allSeedIds;

        uint256 maxScore = 0;
        uint256 leaderCount = 0;

        // First pass: find max score and count leaders
        for (uint256 i = 0; i < candidateSeeds.length; i++) {
            uint256 seedId = candidateSeeds[i];

            // Filter retracted and winning seeds
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

        if (leaderCount == 0) {
            return (0, 0);
        }

        // If only one leader, return it
        if (leaderCount == 1) {
            for (uint256 i = 0; i < candidateSeeds.length; i++) {
                uint256 seedId = candidateSeeds[i];
                if (!seeds[seedId].isWinner && !seeds[seedId].isRetracted && seedBlessingScore[seedId] == maxScore) {
                    return (seedId, maxScore);
                }
            }
        }

        // Multiple leaders - collect them and apply tie-breaking
        uint256[] memory leaders = new uint256[](leaderCount);
        uint256 index = 0;

        for (uint256 i = 0; i < candidateSeeds.length; i++) {
            uint256 seedId = candidateSeeds[i];

            if (!seeds[seedId].isWinner && !seeds[seedId].isRetracted && seedBlessingScore[seedId] == maxScore) {
                leaders[index] = seedId;
                index++;
            }
        }

        // Apply tie-breaking to determine single leader
        uint256 winnerId = _applyTieBreaking(leaders);
        return (winnerId, maxScore);
    }

    /**
     * @notice Get time remaining in current voting period
     * @return seconds remaining
     */
    function getTimeUntilPeriodEnd() external view returns (uint256) {
        uint256 periodEnd = currentVotingPeriodStart + votingPeriod;
        if (block.timestamp >= periodEnd) return 0;
        return periodEnd - block.timestamp;
    }

    /**
     * @notice Get multiple seeds (for pagination)
     * @param _startId Starting seed ID
     * @param _count Number of seeds to return
     * @return Array of Seeds
     */
    function getSeeds(uint256 _startId, uint256 _count) external view returns (Seed[] memory) {
        uint256 endId = _startId + _count;
        if (endId > seedCount) {
            endId = seedCount;
        }

        uint256 resultCount = endId - _startId;
        Seed[] memory result = new Seed[](resultCount);

        for (uint256 i = 0; i < resultCount; i++) {
            result[i] = seeds[_startId + i];
        }

        return result;
    }

    /**
     * @notice Get all seeds submitted in a specific round
     * @param _round Round number
     * @return Array of Seeds from that round
     */
    function getSeedsByRound(uint256 _round) external view returns (Seed[] memory) {
        // Use the roundSeedIds mapping for efficient lookup (no double loop)
        uint256[] memory seedIds = roundSeedIds[_round];
        Seed[] memory result = new Seed[](seedIds.length);

        for (uint256 i = 0; i < seedIds.length; i++) {
            result[i] = seeds[seedIds[i]];
        }

        return result;
    }

    /**
     * @notice Get seeds from current round only
     * @return Array of Seeds from current round
     */
    function getCurrentRoundSeeds() external view returns (Seed[] memory) {
        return this.getSeedsByRound(currentRound);
    }

    /*//////////////////////////////////////////////////////////////
                          VIEW FUNCTIONS - BLESSINGS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Get all blessings for a specific seed
     * @param _seedId ID of the seed
     * @return Array of Blessing structs
     * @dev WARNING: May run out of gas for seeds with many blessings. Use getSeedBlessingsPaginated instead.
     */
    function getSeedBlessings(uint256 _seedId) external view returns (Blessing[] memory) {
        uint256[] memory indices = seedBlessings[_seedId];
        Blessing[] memory result = new Blessing[](indices.length);

        for (uint256 i = 0; i < indices.length; i++) {
            result[i] = allBlessings[indices[i]];
        }

        return result;
    }

    /**
     * @notice Get blessings for a specific seed with pagination
     * @param _seedId ID of the seed
     * @param _offset Starting index
     * @param _limit Maximum number of results to return
     * @return blessings Array of Blessing structs
     * @return total Total number of blessings for this seed
     */
    function getSeedBlessingsPaginated(
        uint256 _seedId,
        uint256 _offset,
        uint256 _limit
    ) external view returns (Blessing[] memory blessings, uint256 total) {
        uint256[] memory indices = seedBlessings[_seedId];
        total = indices.length;

        // Handle edge cases
        if (_offset >= total) {
            return (new Blessing[](0), total);
        }

        uint256 end = _offset + _limit;
        if (end > total) {
            end = total;
        }

        uint256 count = end - _offset;
        Blessing[] memory result = new Blessing[](count);

        for (uint256 i = 0; i < count; i++) {
            result[i] = allBlessings[indices[_offset + i]];
        }

        return (result, total);
    }

    /**
     * @notice Get all blessings given by a specific user
     * @param _user Address of the user
     * @return Array of Blessing structs
     * @dev WARNING: May run out of gas for users with many blessings. Use getUserBlessingsPaginated instead.
     */
    function getUserBlessings(address _user) external view returns (Blessing[] memory) {
        uint256[] memory indices = userBlessings[_user];
        Blessing[] memory result = new Blessing[](indices.length);

        for (uint256 i = 0; i < indices.length; i++) {
            result[i] = allBlessings[indices[i]];
        }

        return result;
    }

    /**
     * @notice Get blessings given by a specific user with pagination
     * @param _user Address of the user
     * @param _offset Starting index
     * @param _limit Maximum number of results to return
     * @return blessings Array of Blessing structs
     * @return total Total number of blessings by this user
     */
    function getUserBlessingsPaginated(
        address _user,
        uint256 _offset,
        uint256 _limit
    ) external view returns (Blessing[] memory blessings, uint256 total) {
        uint256[] memory indices = userBlessings[_user];
        total = indices.length;

        // Handle edge cases
        if (_offset >= total) {
            return (new Blessing[](0), total);
        }

        uint256 end = _offset + _limit;
        if (end > total) {
            end = total;
        }

        uint256 count = end - _offset;
        Blessing[] memory result = new Blessing[](count);

        for (uint256 i = 0; i < count; i++) {
            result[i] = allBlessings[indices[_offset + i]];
        }

        return (result, total);
    }

    /**
     * @notice Get total number of blessings in the system
     * @return Total blessing count
     */
    function getTotalBlessings() external view returns (uint256) {
        return totalBlessingsCount;
    }

    /**
     * @notice Get how many times a user has blessed a specific seed
     * @param _user User address
     * @param _seedId Seed ID
     * @return Number of times user has blessed this seed
     */
    function getBlessingCount(address _user, uint256 _seedId) external view returns (uint256) {
        return userSeedBlessingCount[_user][_seedId];
    }

    /**
     * @notice Check if a user has blessed a specific seed (legacy compatibility)
     * @param _user User address
     * @param _seedId Seed ID
     * @return True if user has blessed this seed at least once
     * @dev Deprecated: Use getBlessingCount for accurate count
     */
    function hasBlessed(address _user, uint256 _seedId) external view returns (bool) {
        return userSeedBlessingCount[_user][_seedId] > 0;
    }

    /**
     * @notice Check if an address is an approved delegate for a user
     * @param _user User address
     * @param _delegate Delegate address
     * @return True if delegate is approved
     */
    function isDelegate(address _user, address _delegate) external view returns (bool) {
        return isDelegateApproved[_user][_delegate];
    }

    /**
     * @notice Get user's blessing count for today
     * @param _user User address
     * @return Number of blessings used today
     */
    function getUserDailyBlessingCount(address _user) external view returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        return userDailyBlessings[_user][currentDay];
    }

    /**
     * @notice Get user's remaining blessings for today
     * @param _user User address
     * @param _nftCount Number of NFTs owned
     * @return Number of blessings remaining today
     */
    function getRemainingBlessings(address _user, uint256 _nftCount) external view returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxBlessings = _nftCount * blessingsPerNFT;
        uint256 used = userDailyBlessings[_user][currentDay];

        if (used >= maxBlessings) {
            return 0;
        }
        return maxBlessings - used;
    }

    /**
     * @notice Check if user can bless today (requires NFT ownership verification)
     * @param _user User address
     * @param _nftCount Number of NFTs owned
     * @return True if user has remaining blessings today
     */
    function canBlessToday(address _user, uint256 _nftCount) external view returns (bool) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 maxBlessings = _nftCount * blessingsPerNFT;
        return userDailyBlessings[_user][currentDay] < maxBlessings;
    }

    /*//////////////////////////////////////////////////////////////
                          VIEW FUNCTIONS - CONFIGURATION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Get current round mode configuration
     * @return Current round mode (ROUND_BASED or NON_ROUND_BASED)
     */
    function getRoundMode() external view returns (RoundMode) {
        return roundMode;
    }

    /**
     * @notice Get current tie-breaking strategy
     * @return Current tie-breaking strategy
     */
    function getTieBreakingStrategy() external view returns (TieBreakingStrategy) {
        return tieBreakingStrategy;
    }

    /**
     * @notice Get current deadlock handling strategy
     * @return Current deadlock strategy
     */
    function getDeadlockStrategy() external view returns (DeadlockStrategy) {
        return deadlockStrategy;
    }

    /**
     * @notice Get total number of seeds ever submitted
     * @return Total seed count
     */
    function getTotalSeedsCount() external view returns (uint256) {
        return allSeedIds.length;
    }

    /**
     * @notice Get total number of eligible seeds (not winners, not retracted)
     * @return Count of eligible seeds
     */
    function getEligibleSeedsCount() external view returns (uint256) {
        return eligibleSeedIds.length;
    }

    /**
     * @notice Get eligible seeds with pagination
     * @param _offset Starting index
     * @param _limit Maximum number of results to return
     * @return Arrayof eligible seed IDs
     */
    function getEligibleSeedsPaginated(
        uint256 _offset,
        uint256 _limit
    ) external view returns (uint256[] memory) {
        uint256 total = eligibleSeedIds.length;

        // Handle edge cases
        if (_offset >= total) {
            return new uint256[](0);
        }

        uint256 end = _offset + _limit;
        if (end > total) {
            end = total;
        }

        uint256 count = end - _offset;
        uint256[] memory result = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            result[i] = eligibleSeedIds[_offset + i];
        }

        return result;
    }

    /**
     * @notice Get seconds remaining until daily blessing limit resets
     * @return Seconds until next UTC midnight (when daily limits reset)
     */
    function getSecondsUntilDailyReset() external view returns (uint256) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 nextDayStart = (currentDay + 1) * 1 days;
        return nextDayStart - block.timestamp;
    }

    /**
     * @notice Get all eligible seeds (not yet winners) for current selection mode
     * @dev Returns seeds based on current round mode
     * @return Array of eligible seed IDs
     */
    function getEligibleSeeds() external view returns (uint256[] memory) {
        uint256[] memory candidateSeeds = roundMode == RoundMode.ROUND_BASED
            ? roundSeedIds[currentRound]
            : allSeedIds;

        // Count eligible seeds (not winners and not retracted)
        uint256 eligibleCount = 0;
        for (uint256 i = 0; i < candidateSeeds.length; i++) {
            if (!seeds[candidateSeeds[i]].isWinner && !seeds[candidateSeeds[i]].isRetracted) {
                eligibleCount++;
            }
        }

        // Collect eligible seeds
        uint256[] memory eligibleSeeds = new uint256[](eligibleCount);
        uint256 index = 0;
        for (uint256 i = 0; i < candidateSeeds.length; i++) {
            if (!seeds[candidateSeeds[i]].isWinner && !seeds[candidateSeeds[i]].isRetracted) {
                eligibleSeeds[index] = candidateSeeds[i];
                index++;
            }
        }

        return eligibleSeeds;
    }

    /**
     * @notice Get current leader(s) with top score from eligible seeds
     * @dev Returns all seeds tied for first place
     * @return leadingSeedIds Array of seed IDs with highest score
     * @return score The highest score
     */
    function getCurrentLeaders() external view returns (uint256[] memory leadingSeedIds, uint256 score) {
        uint256[] memory candidateSeeds = roundMode == RoundMode.ROUND_BASED
            ? roundSeedIds[currentRound]
            : allSeedIds;

        uint256 maxScore = 0;
        uint256 leaderCount = 0;

        // First pass: find max score and count leaders
        for (uint256 i = 0; i < candidateSeeds.length; i++) {
            uint256 seedId = candidateSeeds[i];

            // Filter retracted and winning seeds
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

        if (leaderCount == 0) {
            return (new uint256[](0), 0);
        }

        // Second pass: collect all leaders
        uint256[] memory leaders = new uint256[](leaderCount);
        uint256 index = 0;

        for (uint256 i = 0; i < candidateSeeds.length; i++) {
            uint256 seedId = candidateSeeds[i];

            if (!seeds[seedId].isWinner && !seeds[seedId].isRetracted) {
                uint256 seedScore = seedBlessingScore[seedId];

                if (seedScore == maxScore) {
                    leaders[index] = seedId;
                    index++;
                }
            }
        }

        return (leaders, maxScore);
    }

    /*//////////////////////////////////////////////////////////////
                          INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Verify NFT ownership via Merkle proof with duplicate token ID check
     * @param _voter Address claiming ownership
     * @param _tokenIds Token IDs being claimed
     * @param _merkleProof Merkle proof
     * @return True if proof is valid and no duplicate token IDs
     */
    function _verifyOwnership(
        address _voter,
        uint256[] memory _tokenIds,
        bytes32[] memory _merkleProof
    ) internal view returns (bool) {
        if (currentOwnershipRoot == bytes32(0)) return false;

        // CRITICAL FIX: Check for duplicate token IDs to prevent vote multiplication
        for (uint256 i = 0; i < _tokenIds.length; i++) {
            for (uint256 j = i + 1; j < _tokenIds.length; j++) {
                if (_tokenIds[i] == _tokenIds[j]) {
                    return false; // Duplicate detected, reject
                }
            }
        }

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(_voter, _tokenIds))));
        return MerkleProof.verify(_merkleProof, currentOwnershipRoot, leaf);
    }

    /**
     * @dev Calculate integer square root using Babylonian method
     * @param x Number to find square root of
     * @return y Square root of x (rounded down)
     */
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

    /**
     * @dev Calculate blessing time decay factor based on time remaining in period
     * Prevents last-minute blessing dumps from swinging winners
     *
     * Earlier blessings (more time remaining) get higher weight:
     * - At period start: 1000 (100% weight)
     * - At 50% remaining: ~250 (25% weight)
     * - At 25% remaining: ~62 (6.2% weight)
     * - <1 hour remaining: minimum 10 (1% weight)
     *
     * Uses quadratic decay to heavily penalize last-minute blessings
     *
     * @param timeRemaining Seconds remaining in the blessing period
     * @return Decay factor (10-1000, where 1000 = 100%)
     */
    function _calculateBlessingTimeDecay(uint256 timeRemaining) internal view returns (uint256) {
        if (timeRemaining >= votingPeriod) return 1000; // Full weight at start

        uint256 hoursRemaining = timeRemaining / 1 hours;
        uint256 periodHours = votingPeriod / 1 hours;

        // If voting period is less than an hour, use minutes for finer granularity
        if (periodHours == 0) {
            uint256 minutesRemaining = timeRemaining / 1 minutes;
            uint256 periodMinutes = votingPeriod / 1 minutes;
            if (minutesRemaining == 0) return 10; // Minimum 1% in final minute
            uint256 minuteDecayFactor = (minutesRemaining * minutesRemaining * 1000) / (periodMinutes * periodMinutes);
            return minuteDecayFactor < 10 ? 10 : minuteDecayFactor;
        }

        if (hoursRemaining == 0) return 10; // Minimum 1% in final hour

        // Quadratic decay: (hours_remaining / period_hours)^2 * 1000
        // More gas efficient than exponential while achieving similar effect
        uint256 decayFactor = (hoursRemaining * hoursRemaining * 1000) / (periodHours * periodHours);

        // Ensure minimum weight of 1%
        return decayFactor < 10 ? 10 : decayFactor;
    }

    /**
     * @dev Validate IPFS hash format
     * @param _ipfsHash IPFS hash to validate
     */
    function _validateIPFSHash(string memory _ipfsHash) internal pure {
        bytes memory b = bytes(_ipfsHash);

        if (b.length == 0) {
            revert InvalidIPFSHash();
        }

        // IPFS CIDv0: 46 chars, starts with 'Qm'
        // IPFS CIDv1: 59 chars, starts with 'b'
        // Allow flexibility for other valid IPFS formats
        if (b.length == 46) {
            if (b[0] != 'Q' || b[1] != 'm') {
                revert InvalidIPFSHash();
            }
        } else if (b.length == 59) {
            if (b[0] != 'b') {
                revert InvalidIPFSHash();
            }
        } else if (b.length < 10 || b.length > 100) {
            // Allow some flexibility but reject obviously invalid hashes
            revert InvalidIPFSHash();
        }
    }

    /**
     * @dev Remove a seed from the eligible seeds array (O(1) swap-and-pop)
     * @param _seedId The seed ID to remove from eligible array
     */
    function _removeFromEligibleSeeds(uint256 _seedId) internal {
        // Check if seed is actually in the eligible array
        if (!isInEligibleArray[_seedId]) return;

        uint256 index = eligibleSeedIndex[_seedId];
        uint256 lastIndex = eligibleSeedIds.length - 1;

        // If not the last element, swap with last element
        if (index != lastIndex) {
            uint256 lastSeedId = eligibleSeedIds[lastIndex];
            eligibleSeedIds[index] = lastSeedId;
            eligibleSeedIndex[lastSeedId] = index;
        }

        // Remove last element
        eligibleSeedIds.pop();
        delete eligibleSeedIndex[_seedId];
        isInEligibleArray[_seedId] = false;
    }

    /**
     * @dev Apply deferred configuration updates at round end
     */
    function _applyDeferredConfigUpdates() internal {
        // Apply voting period update if scheduled
        if (nextVotingPeriod > 0) {
            uint256 previous = votingPeriod;
            votingPeriod = nextVotingPeriod;
            nextVotingPeriod = 0;
            emit VotingPeriodUpdated(previous, votingPeriod);
        }

        // Apply blessings per NFT update if scheduled
        if (nextBlessingsPerNFT > 0) {
            uint256 previous = blessingsPerNFT;
            blessingsPerNFT = nextBlessingsPerNFT;
            nextBlessingsPerNFT = 0;
            emit BlessingsPerNFTUpdated(previous, blessingsPerNFT);
        }
    }

}
