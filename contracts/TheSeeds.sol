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
 */
contract TheSeeds is AccessControl, ReentrancyGuard {

    /// @notice Role for backend relayer that can submit blessings on behalf of users
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    /// @notice Role for admin functions (replaces Ownable)
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;

    /// @notice Role for authorized seed creators
    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");

    /// @notice Duration of each voting period (default: 24 hours, configurable)
    uint256 public votingPeriod;

    /// @notice Current Merkle root of FirstWorks NFT ownership (updated daily)
    bytes32 public currentOwnershipRoot;

    /// @notice Timestamp when ownership root was last updated
    uint256 public rootTimestamp;

    /// @notice Start time of the current voting period
    uint256 public currentVotingPeriodStart;

    /// @notice Total number of Seeds submitted
    uint256 public seedCount;

    /// @notice Current voting round number
    uint256 public currentRound;

    /// @notice Contract pause state
    bool public paused;

    /// @notice Total blessings count across all seeds
    uint256 public totalBlessingsCount;

    /// @notice How many blessings each NFT grants per day (default: 1, configurable)
    uint256 public blessingsPerNFT;

    /// @notice Track user's blessing count per day: user => day => count
    /// @dev Day is calculated as block.timestamp / 1 days
    mapping(address => mapping(uint256 => uint256)) public userDailyBlessings;

    struct Seed {
        uint256 id;
        address creator;
        string ipfsHash;        // IPFS hash of the artwork (contains all metadata)
        uint256 blessings;      // Total blessings received (used for winner selection with sqrt + time decay)
        uint256 createdAt;
        bool isWinner;          // True when selected as winner
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

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);

        // Initialize with default values
        votingPeriod = 1 days;
        blessingsPerNFT = 1;

        currentVotingPeriodStart = block.timestamp;
        currentRound = 1;

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
        if (bytes(_ipfsHash).length == 0) {
            revert InvalidSeedData();
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
            winnerInRound: 0,
            submittedInRound: currentRound
        });

        // Add seed to current round's seed list for efficient lookup
        roundSeedIds[currentRound].push(seedId);

        emit SeedSubmitted(seedId, msg.sender, _ipfsHash, "", block.timestamp);

        return seedId;
    }

    /**
     * @notice Retract a submitted Seed (only by creator, before minting)
     * @param _seedId ID of the Seed to retract
     */
    function retractSeed(uint256 _seedId) external {
        Seed storage seed = seeds[_seedId];

        if (seed.createdAt == 0) revert SeedNotFound();
        if (seed.creator != msg.sender) revert NotSeedCreator();
        if (seed.isWinner) revert CannotRetractWinningSeed();

        // Mark as winner to prevent further blessings and voting
        seed.isWinner = true;

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
            if (_blessers[i] == address(0)) revert InvalidBlesser();

            // Verify NFT ownership
            if (!_verifyOwnership(_blessers[i], _tokenIdsArray[i], _merkleProofs[i])) {
                continue; // Skip invalid proofs
            }

            if (_tokenIdsArray[i].length == 0) {
                continue; // Skip if no NFTs
            }

            // Check daily blessing limit (skip if limit reached)
            uint256 currentDay = block.timestamp / 1 days;
            uint256 maxBlessings = _tokenIdsArray[i].length * blessingsPerNFT;
            if (userDailyBlessings[_blessers[i]][currentDay] >= maxBlessings) {
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

        // Prevent blessings after the voting period has ended
        if (block.timestamp >= currentVotingPeriodStart + votingPeriod) {
            revert BlessingPeriodEnded();
        }

        // Update blessing counts
        uint256 previousCount = userSeedBlessingCount[_blesser][_seedId];
        uint256 newCount = previousCount + 1;
        userSeedBlessingCount[_blesser][_seedId] = newCount;
        seed.blessings++;

        // Calculate time-based decay factor (higher weight for earlier blessings)
        // Prevents last-minute blessing dumps from swinging the winner
        uint256 timeRemaining = (currentVotingPeriodStart + votingPeriod) - block.timestamp;
        uint256 blessingDecayFactor = _calculateBlessingTimeDecay(timeRemaining);

        // Update sqrt-adjusted score: remove old contribution, add new contribution with decay
        // Score = sum of (sqrt(blessings) × 1000) × decay_factor for each user
        // Note: We scale sqrt by 1000 to prevent integer truncation (single blessing = score of 10 at min decay)
        uint256 previousScore = previousCount > 0 ? sqrt(previousCount) * 1000 : 0;
        uint256 newScore = sqrt(newCount) * 1000;

        // Apply decay to the score delta (not the total, since old blessings had their own decay)
        uint256 scoreDelta = ((newScore - previousScore) * blessingDecayFactor) / 1000;
        seedBlessingScore[_seedId] = seedBlessingScore[_seedId] + scoreDelta;

        // Store blessing record
        uint256 blessingIndex = allBlessings.length;
        allBlessings.push(Blessing({
            seedId: _seedId,
            blesser: _blesser,
            actor: _actor,
            timestamp: block.timestamp,
            isDelegated: _isDelegated
        }));

        // Index by seed and user
        seedBlessings[_seedId].push(blessingIndex);
        userBlessings[_blesser].push(blessingIndex);
        totalBlessingsCount++;

        emit BlessingSubmitted(_seedId, _blesser, _actor, _isDelegated, block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                          WINNER SELECTION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Select the winning Seed for the current period based on blessings
     * @dev Winner determined by: sqrt(sum of each user's blessings) * time_decay
     * @dev Can be called by anyone after blessing period ends
     * @return winningSeedId The ID of the winning Seed
     */
    function selectDailyWinner() external whenNotPaused nonReentrant returns (uint256) {
        if (block.timestamp < currentVotingPeriodStart + votingPeriod) {
            revert VotingPeriodNotEnded();
        }

        // Get seeds from current round (gas-efficient: only loops through current round's seeds)
        uint256[] memory currentRoundSeedIds = roundSeedIds[currentRound];

        // Check if we have any seeds in this round
        if (currentRoundSeedIds.length == 0) revert NoValidWinner();

        // Find seed with highest score from current round only
        // (blessing time decay already applied during blessing submission)
        uint256 maxScore = 0;
        uint256 winningSeedId = 0;
        bool foundCandidate = false;

        for (uint256 i = 0; i < currentRoundSeedIds.length; i++) {
            uint256 seedId = currentRoundSeedIds[i];

            // Only consider seeds that haven't won yet
            if (!seeds[seedId].isWinner) {
                foundCandidate = true;
                uint256 score = seedBlessingScore[seedId];

                if (score > maxScore) {
                    maxScore = score;
                    winningSeedId = seedId;
                }
            }
        }

        // Check if we found any eligible seeds
        if (!foundCandidate) revert NoValidWinner();

        if (maxScore == 0) revert NoValidWinner();

        // Mark as winner and record round
        Seed storage winningSeed = seeds[winningSeedId];
        winningSeed.isWinner = true;
        winningSeed.winnerInRound = currentRound;
        roundWinners[currentRound] = winningSeedId;

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
     * @notice Pause the contract
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    /**
     * @notice Update the voting period duration
     * @dev Can only be called by admin
     * @dev Does not affect current round, only future rounds
     * @dev Must be at least 1 hour and at most 7 days
     * @param _newVotingPeriod New voting period duration in seconds
     */
    function updateVotingPeriod(uint256 _newVotingPeriod) external onlyRole(ADMIN_ROLE) {
        if (_newVotingPeriod < 1 hours || _newVotingPeriod > 7 days) {
            revert InvalidVotingPeriod();
        }

        uint256 previousPeriod = votingPeriod;
        votingPeriod = _newVotingPeriod;

        emit VotingPeriodUpdated(previousPeriod, _newVotingPeriod);
    }

    /**
     * @notice Update the number of blessings each NFT grants per day
     * @dev Can only be called by admin
     * @dev Takes effect immediately for all users
     * @dev Must be at least 1 and at most 100
     * @param _newBlessingsPerNFT New blessings per NFT amount
     */
    function updateBlessingsPerNFT(uint256 _newBlessingsPerNFT) external onlyRole(ADMIN_ROLE) {
        if (_newBlessingsPerNFT == 0 || _newBlessingsPerNFT > 100) {
            revert InvalidBlessingsPerNFT();
        }

        uint256 previousAmount = blessingsPerNFT;
        blessingsPerNFT = _newBlessingsPerNFT;

        emit BlessingsPerNFTUpdated(previousAmount, _newBlessingsPerNFT);
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
     * @notice Get current leader from current round based on blessing score
     * @return leadingSeedId ID of the Seed with highest score
     * @return score Score (sqrt-adjusted blessings with time decay already applied)
     */
    function getCurrentLeader() external view returns (uint256 leadingSeedId, uint256 score) {
        uint256 maxScore = 0;
        uint256 leaderId = 0;

        // Get seeds from current round (gas-efficient: only loops through current round's seeds)
        uint256[] memory currentRoundSeedIds = roundSeedIds[currentRound];

        for (uint256 i = 0; i < currentRoundSeedIds.length; i++) {
            uint256 seedId = currentRoundSeedIds[i];

            // Only consider seeds that haven't won
            if (!seeds[seedId].isWinner) {
                uint256 seedScore = seedBlessingScore[seedId];

                if (seedScore > maxScore) {
                    maxScore = seedScore;
                    leaderId = seedId;
                }
            }
        }

        return (leaderId, maxScore);
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
     * @notice Get all blessings given by a specific user
     * @param _user Address of the user
     * @return Array of Blessing structs
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
                          INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Verify NFT ownership via Merkle proof
     * @param _voter Address claiming ownership
     * @param _tokenIds Token IDs being claimed
     * @param _merkleProof Merkle proof
     * @return True if proof is valid
     */
    function _verifyOwnership(
        address _voter,
        uint256[] memory _tokenIds,
        bytes32[] memory _merkleProof
    ) internal view returns (bool) {
        if (currentOwnershipRoot == bytes32(0)) return false;

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
}
