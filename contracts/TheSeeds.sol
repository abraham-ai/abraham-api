// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title TheSeeds
 * @notice L2 governance contract for proposing and voting on Seeds (artworks)
 * @dev Uses Merkle proofs to verify L1 FirstWorks NFT ownership for voting eligibility
 *
 * Voting Model:
 * - Each FirstWorks NFT = 1 vote
 * - Daily voting periods with winner selection
 * - Winning Seed gets minted on L1 Abraham Covenant
 */
contract TheSeeds is Ownable, ReentrancyGuard {

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

    struct Seed {
        uint256 id;
        address creator;
        string ipfsHash;        // IPFS hash of the artwork
        string title;
        string description;
        uint256 votes;
        uint256 createdAt;
        bool minted;            // True when selected as winner
        uint256 mintedInRound;  // Round number when minted
    }

    struct Vote {
        uint256 seedId;
        uint256 votePower;      // Number of NFTs voting
        uint256 timestamp;
    }

    /// @notice Mapping of seed ID to Seed data
    mapping(uint256 => Seed) public seeds;

    /// @notice Mapping of voter address => round => Vote details
    mapping(address => mapping(uint256 => Vote)) public roundVotes;

    /// @notice Mapping of round => winning seed ID
    mapping(uint256 => uint256) public roundWinners;

    /// @notice Mapping to track if user voted in a round
    mapping(address => mapping(uint256 => bool)) public hasVotedInRound;


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

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    //error ContractPaused();
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

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _owner) Ownable(_owner) {
        currentVotingPeriodStart = block.timestamp;
        currentRound = 1;

        emit VotingPeriodStarted(1, block.timestamp);
    }

    /*//////////////////////////////////////////////////////////////
                          MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier whenNotPaused() {
        //if (paused) revert ContractPaused();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                          SEED SUBMISSION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Submit a new Seed (artwork proposal)
     * @param _ipfsHash IPFS hash of the artwork
     * @param _title Title of the artwork
     * @param _description Description of the artwork
     * @return seedId The ID of the newly created Seed
     */
    function submitSeed(
        string memory _ipfsHash,
        string memory _title,
        string memory _description
    ) external whenNotPaused returns (uint256) {
        if (bytes(_ipfsHash).length == 0 || bytes(_title).length == 0) {
            revert InvalidSeedData();
        }

        uint256 seedId = seedCount;
        seedCount++;

        seeds[seedId] = Seed({
            id: seedId,
            creator: msg.sender,
            ipfsHash: _ipfsHash,
            title: _title,
            description: _description,
            votes: 0,
            createdAt: block.timestamp,
            minted: false,
            mintedInRound: 0
        });

        emit SeedSubmitted(seedId, msg.sender, _ipfsHash, _title, block.timestamp);

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
     * @notice Update the Merkle root of FirstWorks ownership
     * @dev Called by owner after generating new snapshot
     * @param _newRoot New Merkle root hash
     */
    function updateOwnershipRoot(bytes32 _newRoot) external onlyOwner {
        if (_newRoot == bytes32(0)) revert InvalidOwnershipRoot();

        currentOwnershipRoot = _newRoot;
        rootTimestamp = block.timestamp;

        emit OwnershipRootUpdated(_newRoot, block.timestamp, block.number);
    }

    /**
     * @notice Pause the contract
     */
    function pause() external onlyOwner {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyOwner {
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    /*//////////////////////////////////////////////////////////////
                          VIEW FUNCTIONS
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
