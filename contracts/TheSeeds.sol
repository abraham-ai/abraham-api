// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title TheSeeds
 * @notice L2 governance contract for proposing, voting on, and blessing Seeds (artworks)
 * @dev Uses Merkle proofs to verify L1 FirstWorks NFT ownership for voting eligibility
 *
 * Voting Model:
 * - Each FirstWorks NFT = 1 vote
 * - Daily voting periods with winner selection
 * - Winning Seed gets minted on L1 Abraham Covenant
 *
 * Blessing Model:
 * - Users can bless seeds to show support
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

    /// @notice Duration of each voting period (24 hours)
    uint256 public constant VOTING_PERIOD = 1 days;

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

    /// @notice How many blessings each NFT grants per day
    uint256 public constant BLESSINGS_PER_NFT = 1;

    /// @notice Track user's blessing count per day: user => day => count
    /// @dev Day is calculated as block.timestamp / 1 days
    mapping(address => mapping(uint256 => uint256)) public userDailyBlessings;

    struct Seed {
        uint256 id;
        address creator;
        string ipfsHash;        // IPFS hash of the artwork (contains all metadata)
        uint256 votes;
        uint256 blessings;      // Total blessings received
        uint256 createdAt;
        bool minted;            // True when selected as winner
        uint256 mintedInRound;  // Round number when minted
    }

    struct Vote {
        uint256 seedId;
        uint256 votePower;      // Number of NFTs voting
        uint256 timestamp;
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

    /// @notice Mapping of voter address => round => Vote details
    mapping(address => mapping(uint256 => Vote)) public roundVotes;

    /// @notice Mapping of round => winning seed ID
    mapping(uint256 => uint256) public roundWinners;

    /// @notice Mapping to track if user voted in a round
    mapping(address => mapping(uint256 => bool)) public hasVotedInRound;

    /// @notice Delegation: user => delegate => approved
    /// @dev Users can approve delegates (e.g., backend server, smart wallets) to bless on their behalf
    mapping(address => mapping(address => bool)) public isDelegateApproved;

    /// @notice Track blessing count per user per seed (allows multiple blessings)
    mapping(address => mapping(uint256 => uint256)) public userSeedBlessingCount;

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

    event VoteCast(
        address indexed voter,
        uint256 indexed seedId,
        uint256 votePower,
        uint256 round,
        uint256 timestamp
    );

    event VoteChanged(
        address indexed voter,
        uint256 indexed oldSeedId,
        uint256 indexed newSeedId,
        uint256 votePower,
        uint256 round
    );

    event WinnerSelected(
        uint256 indexed round,
        uint256 indexed seedId,
        string ipfsHash,
        uint256 votes,
        bytes32 seedProof
    );

    event VotingPeriodStarted(uint256 indexed round, uint256 startTime);

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

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error InvalidMerkleProof();
    error SeedNotFound();
    error SeedAlreadyMinted();
    error VotingPeriodNotEnded();
    error NoValidWinner();
    error InvalidSeedData();
    error NotSeedCreator();
    error CannotRetractMintedSeed();
    error InvalidOwnershipRoot();
    error NoVotingPower();
    error NotAuthorized();
    error InvalidBlesser();
    error DailyBlessingLimitReached();
    error MustProvideNFTProof();

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);

        currentVotingPeriodStart = block.timestamp;
        currentRound = 1;

        emit VotingPeriodStarted(1, block.timestamp);
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
            votes: 0,
            blessings: 0,
            createdAt: block.timestamp,
            minted: false,
            mintedInRound: 0
        });

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
        if (seed.minted) revert CannotRetractMintedSeed();

        // Mark as minted to prevent voting
        seed.minted = true;

        emit SeedRetracted(_seedId, msg.sender);
    }

    /*//////////////////////////////////////////////////////////////
                          VOTING FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Vote for a Seed using FirstWorks NFT ownership proof
     * @param _seedId ID of the Seed to vote for
     * @param _tokenIds Array of token IDs owned (voting power)
     * @param _merkleProof Merkle proof of ownership
     */
    function voteForSeed(
        uint256 _seedId,
        uint256[] memory _tokenIds,
        bytes32[] memory _merkleProof
    ) external whenNotPaused nonReentrant {
        Seed storage seed = seeds[_seedId];

        // Validate seed
        if (seed.createdAt == 0) revert SeedNotFound();
        if (seed.minted) revert SeedAlreadyMinted();

        // Verify ownership via Merkle proof
        if (!_verifyOwnership(msg.sender, _tokenIds, _merkleProof)) {
            revert InvalidMerkleProof();
        }

        uint256 votePower = _tokenIds.length;
        if (votePower == 0) revert NoVotingPower();

        // Check if user already voted in this round
        bool alreadyVoted = hasVotedInRound[msg.sender][currentRound];

        if (alreadyVoted) {
            // User is changing their vote
            Vote storage existingVote = roundVotes[msg.sender][currentRound];
            uint256 previousSeedId = existingVote.seedId;

            if (previousSeedId != _seedId) {
                // Remove votes from previous seed
                seeds[previousSeedId].votes -= existingVote.votePower;

                // Add votes to new seed
                seed.votes += votePower;

                // Update vote record
                existingVote.seedId = _seedId;
                existingVote.votePower = votePower;
                existingVote.timestamp = block.timestamp;

                emit VoteChanged(msg.sender, previousSeedId, _seedId, votePower, currentRound);
            } else {
                // Same seed, update vote power if changed
                if (votePower != existingVote.votePower) {
                    if (votePower > existingVote.votePower) {
                        seed.votes += (votePower - existingVote.votePower);
                    } else {
                        seed.votes -= (existingVote.votePower - votePower);
                    }
                    existingVote.votePower = votePower;
                    existingVote.timestamp = block.timestamp;
                }
            }
        } else {
            // First vote in this round
            seed.votes += votePower;

            hasVotedInRound[msg.sender][currentRound] = true;
            roundVotes[msg.sender][currentRound] = Vote({
                seedId: _seedId,
                votePower: votePower,
                timestamp: block.timestamp
            });

            emit VoteCast(msg.sender, _seedId, votePower, currentRound, block.timestamp);
        }
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
            uint256 maxBlessings = _tokenIdsArray[i].length * BLESSINGS_PER_NFT;
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
        uint256 maxBlessings = _nftCount * BLESSINGS_PER_NFT;
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
        if (seed.minted) revert SeedAlreadyMinted();

        // Increment blessing count for this user-seed pair
        userSeedBlessingCount[_blesser][_seedId]++;
        seed.blessings++;

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
     * @notice Select the winning Seed for the current period
     * @dev Can be called by anyone after voting period ends
     * @return winningSeedId The ID of the winning Seed
     */
    function selectDailyWinner() external whenNotPaused nonReentrant returns (uint256) {
        if (block.timestamp < currentVotingPeriodStart + VOTING_PERIOD) {
            revert VotingPeriodNotEnded();
        }

        // Find seed with most votes
        uint256 maxVotes = 0;
        uint256 winningSeedId = 0;

        for (uint256 i = 0; i < seedCount; i++) {
            if (!seeds[i].minted && seeds[i].votes > maxVotes) {
                maxVotes = seeds[i].votes;
                winningSeedId = i;
            }
        }

        if (maxVotes == 0) revert NoValidWinner();

        // Mark as minted and record winner
        Seed storage winningSeed = seeds[winningSeedId];
        winningSeed.minted = true;
        winningSeed.mintedInRound = currentRound;
        roundWinners[currentRound] = winningSeedId;

        // Generate proof for L1 verification
        bytes32 seedProof = keccak256(
            abi.encodePacked(
                winningSeedId,
                winningSeed.ipfsHash,
                winningSeed.votes,
                currentRound,
                block.timestamp
            )
        );

        // Start new voting period
        currentRound++;
        currentVotingPeriodStart = block.timestamp;

        emit WinnerSelected(
            currentRound - 1,
            winningSeedId,
            winningSeed.ipfsHash,
            maxVotes,
            seedProof
        );
        emit VotingPeriodStarted(currentRound, block.timestamp);

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
     * @notice Get current voting leader
     * @return leadingSeedId ID of the Seed with most votes
     * @return votes Number of votes
     */
    function getCurrentLeader() external view returns (uint256 leadingSeedId, uint256 votes) {
        uint256 maxVotes = 0;
        uint256 leaderId = 0;

        for (uint256 i = 0; i < seedCount; i++) {
            if (!seeds[i].minted && seeds[i].votes > maxVotes) {
                maxVotes = seeds[i].votes;
                leaderId = i;
            }
        }

        return (leaderId, maxVotes);
    }

    /**
     * @notice Get time remaining in current voting period
     * @return seconds remaining
     */
    function getTimeUntilPeriodEnd() external view returns (uint256) {
        uint256 periodEnd = currentVotingPeriodStart + VOTING_PERIOD;
        if (block.timestamp >= periodEnd) return 0;
        return periodEnd - block.timestamp;
    }

    /**
     * @notice Get voter's current vote in this round
     * @param _voter Address of the voter
     * @return Vote details
     */
    function getVoterCurrentVote(address _voter) external view returns (Vote memory) {
        return roundVotes[_voter][currentRound];
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
        uint256 maxBlessings = _nftCount * BLESSINGS_PER_NFT;
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
        uint256 maxBlessings = _nftCount * BLESSINGS_PER_NFT;
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
}
