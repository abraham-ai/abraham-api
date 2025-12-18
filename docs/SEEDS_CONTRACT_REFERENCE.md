# The Seeds Contract - Complete Function Reference

This document provides a comprehensive reference for all functions in [TheSeeds.sol](../contracts/TheSeeds.sol) smart contract with code examples for each function.

## Table of Contents

- [Contract Overview](#contract-overview)
- [Core Concepts](#core-concepts)
- [Enums & Constants](#enums--constants)
- [Seed Management Functions](#seed-management-functions)
- [Blessing Functions](#blessing-functions)
- [Winner Selection Functions](#winner-selection-functions)
- [Query Functions (Read-Only)](#query-functions-read-only)
- [Configuration Functions (Admin)](#configuration-functions-admin)
- [Role Management Functions (Admin)](#role-management-functions-admin)
- [NFT Functions (ERC721)](#nft-functions-erc721)
- [Events](#events)
- [Code Examples](#code-examples)

---

## Contract Overview

**TheSeeds** is an ERC721 NFT contract that manages a daily competition system where users can submit "seeds" (artwork proposals) and vote on them through "blessings". The contract features:

- **Square root anti-whale scoring** - Prevents whales from dominating by using sqrt of per-user blessings
- **Time decay mechanism** - Earlier blessings in a round count slightly more than later ones
- **Round-based competitions** - Daily rounds with configurable periods
- **NFT-gated voting** - Only FirstWorks NFT holders can bless seeds
- **Role-based access control** - ADMIN, CREATOR, and RELAYER roles
- **Merkle proof verification** - On-chain verification of NFT ownership
- **Configurable strategies** - Tie-breaking, deadlock handling, round modes

**Deployed Networks:**
- Base Sepolia (testnet)
- Base (mainnet)

---

## Core Concepts

### Seeds
A **Seed** is a proposal for artwork, stored on-chain with IPFS metadata. Seeds have:
- Unique ID (auto-incremented)
- Creator address
- IPFS hash (containing title, description, image)
- Blessing count (raw count)
- Blessing score (sqrt-scaled anti-whale score)
- Winner status
- Round submission tracking

### Blessings
**Blessings** are votes on seeds. The blessing system features:
- NFT-gated: Only FirstWorks NFT holders can bless
- Daily limit: 1 blessing per NFT owned per 24 hours
- Time decay: Blessings cast earlier in a round have slightly higher weight
- Anti-whale: Uses sqrt(blessings_per_user) to prevent single-user dominance
- Merkle proof verification: On-chain verification prevents cheating

### Scoring Formula
```
For each user's blessings on a seed:
  user_score = sqrt(user_blessing_count) * time_decay_factor

Total seed score = sum of all user_scores

Time decay factor:
  - Start of round: 1000 (100%)
  - End of round: 10 (1%)
  - Formula: (hours_remaining² / total_hours²) * 1000
```

### Rounds
- **Duration**: Configurable (default 24 hours)
- **Winner selection**: Highest scoring seed wins
- **NFT minting**: Winner gets an ERC721 token
- **New round**: Automatically starts after winner selection

---

## Enums & Constants

### RoundMode
```solidity
enum RoundMode {
    ROUND_BASED,      // 0: Only seeds from current round compete
    NON_ROUND_BASED   // 1: All eligible seeds compete globally
}
```

### TieBreakingStrategy
```solidity
enum TieBreakingStrategy {
    LOWEST_SEED_ID,        // 0: First submitted wins
    EARLIEST_SUBMISSION,   // 1: Earliest timestamp wins
    PSEUDO_RANDOM          // 2: Block-based randomness
}
```

### DeadlockStrategy
```solidity
enum DeadlockStrategy {
    REVERT,      // 0: Transaction fails if no valid winner
    SKIP_ROUND   // 1: Skip to next round if no valid winner
}
```

### Constants
```solidity
uint256 public constant MAX_SEEDS_PER_ROUND = 1000;
uint256 public constant MAX_TOTAL_SEEDS = 100000;
uint256 public constant SCORE_SCALE_FACTOR = 1e6;

bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");
bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
```

---

## Seed Management Functions

### submitSeed
Submit a new seed to the current round.

**Signature:**
```solidity
function submitSeed(string memory _ipfsHash)
    external
    whenNotPaused
    onlyRole(CREATOR_ROLE)
    returns (uint256)
```

**Access:** CREATOR_ROLE required

**Parameters:**
- `_ipfsHash` - IPFS hash containing seed metadata (title, description, image)

**Returns:** Seed ID (uint256)

**Validation:**
- IPFS hash must be valid format (46 or 59 chars, starts with Qm or b)
- Total seeds < MAX_TOTAL_SEEDS (100,000)
- Round seeds < MAX_SEEDS_PER_ROUND (1,000)
- Contract not paused

**Events Emitted:**
```solidity
event SeedSubmitted(uint256 indexed seedId, address indexed creator, string ipfsHash, uint256 timestamp);
```

**Example Usage:**
```typescript
import { theSeedsABI } from './abi/TheSeeds';

// Submit a seed
const tx = await walletClient.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'submitSeed',
  args: ['QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'] // IPFS hash
});

const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

// Get seed ID from event
const log = receipt.logs.find(log => log.topics[0] === SEED_SUBMITTED_EVENT);
const seedId = Number(log.topics[1]);

console.log(`Seed ${seedId} submitted!`);
```

---

### retractSeed
Retract a seed (creator only, cannot retract winners).

**Signature:**
```solidity
function retractSeed(uint256 _seedId) external
```

**Access:** Seed creator only

**Parameters:**
- `_seedId` - ID of seed to retract

**Requirements:**
- Caller must be seed creator
- Seed must exist
- Seed must not be a winner
- Seed must not already be retracted

**Events Emitted:**
```solidity
event SeedRetracted(uint256 indexed seedId, address indexed creator);
```

**Example Usage:**
```typescript
// Retract your seed
const tx = await walletClient.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'retractSeed',
  args: [42] // seed ID
});

await publicClient.waitForTransactionReceipt({ hash: tx });
console.log('Seed retracted');
```

---

### getSeed
Get complete seed information.

**Signature:**
```solidity
function getSeed(uint256 _seedId)
    external
    view
    returns (Seed memory)
```

**Access:** Public (read-only)

**Parameters:**
- `_seedId` - Seed ID to query

**Returns:** Seed struct
```solidity
struct Seed {
    uint256 id;
    address creator;
    string ipfsHash;
    uint256 blessings;        // Raw blessing count
    uint256 createdAt;
    bool isWinner;
    bool isRetracted;
    uint256 winnerInRound;    // Round number when won (0 if not winner)
    uint256 submittedInRound; // Round number when submitted
}
```

**Example Usage:**
```typescript
const seed = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getSeed',
  args: [42]
});

console.log({
  id: Number(seed.id),
  creator: seed.creator,
  ipfsHash: seed.ipfsHash,
  blessings: Number(seed.blessings),
  isWinner: seed.isWinner,
  winnerInRound: Number(seed.winnerInRound)
});
```

---

## Blessing Functions

### blessSeed
Bless a seed with your own NFTs (user signs transaction).

**Signature:**
```solidity
function blessSeed(
    uint256 _seedId,
    uint256[] memory _tokenIds,
    bytes32[] memory _merkleProof
) external whenNotPaused nonReentrant
```

**Access:** Public (requires NFT ownership)

**Parameters:**
- `_seedId` - ID of seed to bless
- `_tokenIds` - Array of FirstWorks NFT token IDs you own
- `_merkleProof` - Merkle proof of ownership

**Requirements:**
- Must own the NFTs (verified via merkle proof)
- Seed must exist and not be winner/retracted
- Voting period must not have ended
- Must not exceed daily blessing limit (1 per NFT per day)
- No duplicate token IDs in array

**Events Emitted:**
```solidity
event BlessingSubmitted(uint256 indexed seedId, address indexed blesser, address indexed actor, bool isDelegated, uint256 timestamp);
event SeedScoreUpdated(uint256 indexed seedId, address indexed blesser, uint256 previousScore, uint256 newScore);
```

**Example Usage:**
```typescript
// Get your NFT token IDs and merkle proof
const tokenIds = [1, 5, 10]; // Your FirstWorks NFT IDs
const merkleProof = ['0x...', '0x...']; // From API or merkle tree

// Bless a seed
const tx = await walletClient.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'blessSeed',
  args: [
    42,           // seed ID
    tokenIds,     // your NFT IDs
    merkleProof   // proof of ownership
  ]
});

await publicClient.waitForTransactionReceipt({ hash: tx });
console.log('Blessing submitted!');
```

---

### blessSeedFor
Bless a seed on behalf of another user (relayer/delegate).

**Signature:**
```solidity
function blessSeedFor(
    uint256 _seedId,
    address _blesser,
    uint256[] memory _tokenIds,
    bytes32[] memory _merkleProof
) external whenNotPaused nonReentrant
```

**Access:** RELAYER_ROLE or approved delegate

**Parameters:**
- `_seedId` - ID of seed to bless
- `_blesser` - Address of the user blessing
- `_tokenIds` - Array of NFT token IDs owned by _blesser
- `_merkleProof` - Merkle proof of _blesser's ownership

**Requirements:**
- Caller must have RELAYER_ROLE OR be approved delegate for _blesser
- _blesser must own the NFTs (verified via merkle proof)
- Same requirements as blessSeed

**Events Emitted:** Same as blessSeed (with isDelegated = true)

**Example Usage:**
```typescript
// Backend relayer blessing on behalf of user (gasless)
const tx = await relayerWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'blessSeedFor',
  args: [
    seedId,
    userAddress,  // who is blessing
    tokenIds,     // their NFTs
    merkleProof   // proof they own NFTs
  ]
});

await publicClient.waitForTransactionReceipt({ hash: tx });
```

---

### batchBlessSeedsFor
Batch bless multiple seeds (relayer only, optimized gas).

**Signature:**
```solidity
function batchBlessSeedsFor(
    uint256[] calldata _seedIds,
    address[] calldata _blessers,
    uint256[][] calldata _tokenIdsArray,
    bytes32[][] calldata _merkleProofs
) external whenNotPaused nonReentrant onlyRole(RELAYER_ROLE)
```

**Access:** RELAYER_ROLE only

**Parameters:**
- `_seedIds` - Array of seed IDs
- `_blessers` - Array of blesser addresses (parallel to _seedIds)
- `_tokenIdsArray` - 2D array of token IDs (one array per blesser)
- `_merkleProofs` - 2D array of proofs (one array per blesser)

**Requirements:**
- All arrays must have same length
- Caller must have RELAYER_ROLE
- Skips invalid blessings instead of reverting

**Example Usage:**
```typescript
// Batch bless for efficiency
const tx = await relayerWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'batchBlessSeedsFor',
  args: [
    [1, 2, 3],                    // seed IDs
    [user1, user2, user3],        // blessers
    [[1], [2, 3], [4]],          // token IDs per user
    [proof1, proof2, proof3]      // proofs
  ]
});
```

---

### approveDelegate
Approve or revoke a delegate to bless on your behalf.

**Signature:**
```solidity
function approveDelegate(address _delegate, bool _approved) external
```

**Access:** Public

**Parameters:**
- `_delegate` - Address to approve/revoke
- `_approved` - true to approve, false to revoke

**Events Emitted:**
```solidity
event DelegateApproval(address indexed user, address indexed delegate, bool approved);
```

**Example Usage:**
```typescript
// Approve backend to bless on your behalf (for gasless blessings)
const BACKEND_RELAYER = '0x...';

const tx = await walletClient.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'approveDelegate',
  args: [BACKEND_RELAYER, true]
});

await publicClient.waitForTransactionReceipt({ hash: tx });
console.log('Backend approved for gasless blessings!');
```

---

## Winner Selection Functions

### selectDailyWinner
Select the winner of the current round and start new round.

**Signature:**
```solidity
function selectDailyWinner()
    external
    whenNotPaused
    nonReentrant
    returns (uint256)
```

**Access:** Public (but typically called by backend/admin)

**Requirements:**
- Voting period must have ended
- At least one eligible seed with score > 0
- Uses configured tie-breaking and deadlock strategies

**Side Effects:**
- Marks winning seed as winner
- Mints ERC721 NFT to contract (held until elevated)
- Increments round number
- Starts new voting period
- Applies deferred config updates
- Removes winner from eligible seeds

**Returns:** Winning seed ID

**Events Emitted:**
```solidity
event WinnerSelected(uint256 indexed round, uint256 indexed seedId, string ipfsHash, uint256 blessings, uint256 score);
event SeedNFTMinted(uint256 indexed tokenId, uint256 indexed seedId, address indexed creator, uint256 round);
event BlessingPeriodStarted(uint256 indexed round, uint256 startTime);
```

**Example Usage:**
```typescript
// Usually called by backend cron job
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'selectDailyWinner',
  args: []
});

const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

// Parse winning seed ID from event
const winnerEvent = receipt.logs.find(log =>
  log.topics[0] === WINNER_SELECTED_EVENT
);
const winningSeedId = Number(winnerEvent.topics[2]);

console.log(`Winner: Seed ${winningSeedId}`);
```

---

## Query Functions (Read-Only)

### seedCount
Get total number of seeds created.

**Signature:**
```solidity
function seedCount() external view returns (uint256)
```

**Example:**
```typescript
const count = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'seedCount'
});
console.log(`Total seeds: ${count}`);
```

---

### currentRound
Get current round number.

**Signature:**
```solidity
function currentRound() external view returns (uint256)
```

**Example:**
```typescript
const round = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'currentRound'
});
console.log(`Round ${round}`);
```

---

### getSeedsByRound
Get all seeds from a specific round.

**Signature:**
```solidity
function getSeedsByRound(uint256 _round)
    external
    view
    returns (Seed[] memory)
```

**Parameters:**
- `_round` - Round number

**Returns:** Array of Seed structs

**Example:**
```typescript
const seeds = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getSeedsByRound',
  args: [5] // round 5
});

console.log(`Round 5 had ${seeds.length} seeds`);
```

---

### getCurrentRoundSeeds
Get all seeds from the current round.

**Signature:**
```solidity
function getCurrentRoundSeeds() external view returns (Seed[] memory)
```

**Example:**
```typescript
const seeds = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getCurrentRoundSeeds'
});

console.log(`Current round: ${seeds.length} seeds competing`);
```

---

### getTimeUntilPeriodEnd
Get seconds remaining in current voting period.

**Signature:**
```solidity
function getTimeUntilPeriodEnd() external view returns (uint256)
```

**Returns:** Seconds remaining (0 if period ended)

**Example:**
```typescript
const remaining = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getTimeUntilPeriodEnd'
});

const hours = Number(remaining) / 3600;
console.log(`${hours.toFixed(1)} hours until winner selection`);
```

---

### getCurrentLeader
Get current leading seed (single, breaks ties).

**Signature:**
```solidity
function getCurrentLeader()
    external
    view
    returns (uint256 leadingSeedId, uint256 score)
```

**Returns:**
- `leadingSeedId` - ID of leading seed (0 if none)
- `score` - Blessing score of leader

**Example:**
```typescript
const [leaderId, score] = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getCurrentLeader'
});

console.log(`Leader: Seed ${leaderId} with score ${score}`);
```

---

### getCurrentLeaders
Get all current leaders (multiple if tied).

**Signature:**
```solidity
function getCurrentLeaders()
    external
    view
    returns (uint256[] memory leadingSeedIds, uint256 score)
```

**Returns:**
- `leadingSeedIds` - Array of tied leader IDs
- `score` - Score of leaders

**Example:**
```typescript
const [leaders, score] = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getCurrentLeaders'
});

if (leaders.length > 1) {
  console.log(`${leaders.length}-way tie at score ${score}`);
} else {
  console.log(`Leader: Seed ${leaders[0]}`);
}
```

---

### seedBlessingScore
Get blessing score for a specific seed.

**Signature:**
```solidity
function seedBlessingScore(uint256 _seedId)
    external
    view
    returns (uint256)
```

**Parameters:**
- `_seedId` - Seed ID

**Returns:** Blessing score (scaled by SCORE_SCALE_FACTOR = 1e6)

**Example:**
```typescript
const score = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'seedBlessingScore',
  args: [42]
});

// Score is scaled by 1e6, so divide for human-readable
const readableScore = Number(score) / 1e6;
console.log(`Seed 42 score: ${readableScore.toFixed(2)}`);
```

---

### seedScoreByRound
Get seed's score in a specific round.

**Signature:**
```solidity
function seedScoreByRound(uint256 _round, uint256 _seedId)
    external
    view
    returns (uint256)
```

**Parameters:**
- `_round` - Round number
- `_seedId` - Seed ID

**Returns:** Score in that round

**Example:**
```typescript
const score = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'seedScoreByRound',
  args: [3, 10] // round 3, seed 10
});
```

---

### getBlessingCount
Get how many times a user has blessed a specific seed (all-time).

**Signature:**
```solidity
function getBlessingCount(address _user, uint256 _seedId)
    external
    view
    returns (uint256)
```

**Example:**
```typescript
const count = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getBlessingCount',
  args: [userAddress, 42]
});

console.log(`User blessed seed 42 ${count} times`);
```

---

### isDelegate
Check if an address is an approved delegate for a user.

**Signature:**
```solidity
function isDelegate(address _user, address _delegate)
    external
    view
    returns (bool)
```

**Example:**
```typescript
const isApproved = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'isDelegate',
  args: [userAddress, backendRelayer]
});

console.log(`Backend approved: ${isApproved}`);
```

---

### getUserDailyBlessingCount
Get how many blessings a user has performed today.

**Signature:**
```solidity
function getUserDailyBlessingCount(address _user)
    external
    view
    returns (uint256)
```

**Returns:** Blessings used today

**Example:**
```typescript
const used = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getUserDailyBlessingCount',
  args: [userAddress]
});

console.log(`Used ${used} blessings today`);
```

---

### getRemainingBlessings
Get how many blessings a user has left today.

**Signature:**
```solidity
function getRemainingBlessings(address _user, uint256 _nftCount)
    external
    view
    returns (uint256)
```

**Parameters:**
- `_user` - User address
- `_nftCount` - Number of FirstWorks NFTs owned

**Returns:** Remaining blessings

**Example:**
```typescript
const nftCount = 3;
const remaining = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getRemainingBlessings',
  args: [userAddress, nftCount]
});

console.log(`${remaining} of ${nftCount} blessings left today`);
```

---

### canBlessToday
Check if user can bless today (has remaining blessings).

**Signature:**
```solidity
function canBlessToday(address _user, uint256 _nftCount)
    external
    view
    returns (bool)
```

**Example:**
```typescript
const canBless = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'canBlessToday',
  args: [userAddress, 3]
});

console.log(`Can bless: ${canBless}`);
```

---

### getSecondsUntilDailyReset
Get seconds until daily blessing limit resets.

**Signature:**
```solidity
function getSecondsUntilDailyReset() external view returns (uint256)
```

**Returns:** Seconds until midnight UTC

**Example:**
```typescript
const seconds = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getSecondsUntilDailyReset'
});

const hours = Number(seconds) / 3600;
console.log(`Blessing limit resets in ${hours.toFixed(1)} hours`);
```

---

### getEligibleSeedsCount
Get count of eligible seeds (non-winner, non-retracted).

**Signature:**
```solidity
function getEligibleSeedsCount() external view returns (uint256)
```

**Example:**
```typescript
const count = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getEligibleSeedsCount'
});

console.log(`${count} eligible seeds`);
```

---

### Configuration Getters

```solidity
function getRoundMode() external view returns (RoundMode);
function getTieBreakingStrategy() external view returns (TieBreakingStrategy);
function getDeadlockStrategy() external view returns (DeadlockStrategy);
```

**Example:**
```typescript
const mode = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getRoundMode'
});
// 0 = ROUND_BASED, 1 = NON_ROUND_BASED
```

---

## Configuration Functions (Admin)

### updateVotingPeriod
Update voting period (takes effect after next winner selection).

**Signature:**
```solidity
function updateVotingPeriod(uint256 _newVotingPeriod)
    external
    onlyRole(ADMIN_ROLE)
```

**Access:** ADMIN_ROLE only

**Parameters:**
- `_newVotingPeriod` - New period in seconds (1 hour to 7 days)

**Requirements:**
- Must be between 3600 (1 hour) and 604800 (7 days)

**Events Emitted:**
```solidity
event VotingPeriodUpdated(uint256 previousPeriod, uint256 newPeriod);
```

**Example:**
```typescript
// Set voting period to 12 hours
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'updateVotingPeriod',
  args: [12 * 3600] // 12 hours in seconds
});

await publicClient.waitForTransactionReceipt({ hash: tx });
console.log('Voting period updated (takes effect next round)');
```

---

### updateBlessingsPerNFT
Update how many blessings each NFT grants per day.

**Signature:**
```solidity
function updateBlessingsPerNFT(uint256 _newBlessingsPerNFT)
    external
    onlyRole(ADMIN_ROLE)
```

**Parameters:**
- `_newBlessingsPerNFT` - New amount (1 to 100)

**Example:**
```typescript
// Give 2 blessings per NFT instead of 1
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'updateBlessingsPerNFT',
  args: [2]
});
```

---

### updateScoreResetPolicy
Set whether scores reset each round.

**Signature:**
```solidity
function updateScoreResetPolicy(bool _enabled)
    external
    onlyRole(ADMIN_ROLE)
```

**Parameters:**
- `_enabled` - true = reset scores each round, false = cumulative

**Example:**
```typescript
// Enable round-based score reset
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'updateScoreResetPolicy',
  args: [true]
});
```

---

### updateRoundMode
Set round mode (round-based vs global competition).

**Signature:**
```solidity
function updateRoundMode(RoundMode _newRoundMode)
    external
    onlyRole(ADMIN_ROLE)
```

**Parameters:**
- `_newRoundMode` - 0 = ROUND_BASED, 1 = NON_ROUND_BASED

**Example:**
```typescript
// Set to NON_ROUND_BASED (all seeds compete)
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'updateRoundMode',
  args: [1] // 1 = NON_ROUND_BASED
});
```

---

### updateTieBreakingStrategy
Set tie-breaking strategy.

**Signature:**
```solidity
function updateTieBreakingStrategy(TieBreakingStrategy _newStrategy)
    external
    onlyRole(ADMIN_ROLE)
```

**Parameters:**
- `_newStrategy` - 0 = LOWEST_SEED_ID, 1 = EARLIEST_SUBMISSION, 2 = PSEUDO_RANDOM

**Example:**
```typescript
// Use pseudo-random tie breaking
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'updateTieBreakingStrategy',
  args: [2] // 2 = PSEUDO_RANDOM
});
```

---

### updateDeadlockStrategy
Set deadlock handling strategy.

**Signature:**
```solidity
function updateDeadlockStrategy(DeadlockStrategy _newStrategy)
    external
    onlyRole(ADMIN_ROLE)
```

**Parameters:**
- `_newStrategy` - 0 = REVERT, 1 = SKIP_ROUND

**Example:**
```typescript
// Skip round instead of reverting
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'updateDeadlockStrategy',
  args: [1] // 1 = SKIP_ROUND
});
```

---

### updateOwnershipRoot
Update Merkle root for NFT ownership verification.

**Signature:**
```solidity
function updateOwnershipRoot(bytes32 _newRoot)
    external
    onlyRole(ADMIN_ROLE)
```

**Parameters:**
- `_newRoot` - New Merkle root

**Requirements:**
- Root cannot be zero bytes

**Events Emitted:**
```solidity
event OwnershipRootUpdated(bytes32 indexed newRoot, uint256 timestamp, uint256 blockNumber);
```

**Example:**
```typescript
// Update merkle root (usually from snapshot)
const newRoot = '0x1234...'; // From merkle tree generation

const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'updateOwnershipRoot',
  args: [newRoot]
});

await publicClient.waitForTransactionReceipt({ hash: tx });
console.log('Merkle root updated');
```

---

### pause / unpause
Pause or unpause the contract.

**Signature:**
```solidity
function pause() external onlyRole(ADMIN_ROLE);
function unpause() external onlyRole(ADMIN_ROLE);
```

**Example:**
```typescript
// Pause contract (emergency stop)
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'pause'
});

// Unpause
const tx2 = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'unpause'
});
```

---

## Role Management Functions (Admin)

### addCreator / removeCreator
Grant or revoke CREATOR_ROLE.

**Signature:**
```solidity
function addCreator(address _creator) external onlyRole(ADMIN_ROLE);
function removeCreator(address _creator) external onlyRole(ADMIN_ROLE);
```

**Example:**
```typescript
// Grant creator role to artist
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'addCreator',
  args: ['0x...artistAddress']
});

// Revoke
const tx2 = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'removeCreator',
  args: ['0x...artistAddress']
});
```

---

### addRelayer / removeRelayer
Grant or revoke RELAYER_ROLE.

**Signature:**
```solidity
function addRelayer(address _relayer) external onlyRole(ADMIN_ROLE);
function removeRelayer(address _relayer) external onlyRole(ADMIN_ROLE);
```

**Example:**
```typescript
// Grant relayer role to backend
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'addRelayer',
  args: ['0x...backendAddress']
});
```

---

## NFT Functions (ERC721)

The contract is ERC721 compliant. When a seed wins, an NFT is minted.

### getTokenIdBySeedId
Get NFT token ID for a winning seed.

**Signature:**
```solidity
function getTokenIdBySeedId(uint256 seedId)
    external
    view
    returns (uint256)
```

**Returns:** Token ID (0 if seed hasn't won)

**Example:**
```typescript
const tokenId = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getTokenIdBySeedId',
  args: [42]
});

if (tokenId === 0n) {
  console.log('Seed has not won yet');
} else {
  console.log(`Seed 42 NFT token ID: ${tokenId}`);
}
```

---

### getSeedIdByTokenId
Get seed ID for an NFT token.

**Signature:**
```solidity
function getSeedIdByTokenId(uint256 tokenId)
    external
    view
    returns (uint256)
```

**Returns:** Seed ID

**Example:**
```typescript
const seedId = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getSeedIdByTokenId',
  args: [1] // token ID
});

console.log(`Token 1 is for seed ${seedId}`);
```

---

### tokenURI
Get metadata URI for an NFT token.

**Signature:**
```solidity
function tokenURI(uint256 tokenId)
    public
    view
    override
    returns (string memory)
```

**Returns:** URI (IPFS or custom base URI + IPFS hash)

**Example:**
```typescript
const uri = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'tokenURI',
  args: [1]
});

console.log(`Token 1 URI: ${uri}`);
// e.g., "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
```

---

### setBaseURI
Set custom base URI for token metadata.

**Signature:**
```solidity
function setBaseURI(string memory baseURI_)
    external
    onlyRole(ADMIN_ROLE)
```

**Example:**
```typescript
// Use custom IPFS gateway
const tx = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'setBaseURI',
  args: ['https://gateway.pinata.cloud/ipfs/']
});

// Clear base URI (use default ipfs://)
const tx2 = await adminWallet.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'setBaseURI',
  args: ['']
});
```

---

## Events

### SeedSubmitted
```solidity
event SeedSubmitted(
    uint256 indexed seedId,
    address indexed creator,
    string ipfsHash,
    uint256 timestamp
);
```

### BlessingSubmitted
```solidity
event BlessingSubmitted(
    uint256 indexed seedId,
    address indexed blesser,
    address indexed actor,
    bool isDelegated,
    uint256 timestamp
);
```

### SeedScoreUpdated
```solidity
event SeedScoreUpdated(
    uint256 indexed seedId,
    address indexed blesser,
    uint256 previousScore,
    uint256 newScore
);
```

### WinnerSelected
```solidity
event WinnerSelected(
    uint256 indexed round,
    uint256 indexed seedId,
    string ipfsHash,
    uint256 blessings,
    uint256 score
);
```

### SeedNFTMinted
```solidity
event SeedNFTMinted(
    uint256 indexed tokenId,
    uint256 indexed seedId,
    address indexed creator,
    uint256 round
);
```

### BlessingPeriodStarted
```solidity
event BlessingPeriodStarted(
    uint256 indexed round,
    uint256 startTime
);
```

### SeedRetracted
```solidity
event SeedRetracted(
    uint256 indexed seedId,
    address indexed creator
);
```

### DelegateApproval
```solidity
event DelegateApproval(
    address indexed user,
    address indexed delegate,
    bool approved
);
```

### OwnershipRootUpdated
```solidity
event OwnershipRootUpdated(
    bytes32 indexed newRoot,
    uint256 timestamp,
    uint256 blockNumber
);
```

### VotingPeriodUpdated
```solidity
event VotingPeriodUpdated(
    uint256 previousPeriod,
    uint256 newPeriod
);
```

### BlessingsPerNFTUpdated
```solidity
event BlessingsPerNFTUpdated(
    uint256 previousAmount,
    uint256 newAmount
);
```

### RoundModeUpdated
```solidity
event RoundModeUpdated(
    RoundMode previousMode,
    RoundMode newMode
);
```

### TieBreakingStrategyUpdated
```solidity
event TieBreakingStrategyUpdated(
    TieBreakingStrategy previousStrategy,
    TieBreakingStrategy newStrategy
);
```

### DeadlockStrategyUpdated
```solidity
event DeadlockStrategyUpdated(
    DeadlockStrategy previousStrategy,
    DeadlockStrategy newStrategy
);
```

### RoundSkipped
```solidity
event RoundSkipped(
    uint256 indexed round,
    uint256 timestamp
);
```

### ContractPaused / ContractUnpaused
```solidity
event ContractPaused(address indexed by);
event ContractUnpaused(address indexed by);
```

---

## Code Examples

### Complete Seed Submission Flow
```typescript
import { createPublicClient, createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Setup clients
const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.RPC_URL)
});

const account = privateKeyToAccount('0x...');
const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(process.env.RPC_URL)
});

// 1. Prepare IPFS metadata
const metadata = {
  name: "My Amazing Seed",
  description: "A revolutionary art concept",
  image: "ipfs://QmImage...",
  attributes: [
    { trait_type: "Style", value: "Abstract" },
    { trait_type: "Theme", value: "Nature" }
  ]
};

// Upload metadata to IPFS (using Pinata, Infura, or other)
const ipfsHash = await uploadToIPFS(metadata); // Returns: QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG

// 2. Check if you have CREATOR_ROLE
const CREATOR_ROLE = '0x828634d95e775031b9ff576c159e20a8a57946bda7a10f5b0e5f3b5f0e0ad4e7';
const hasRole = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'hasRole',
  args: [CREATOR_ROLE, account.address]
});

if (!hasRole) {
  throw new Error('You do not have CREATOR_ROLE');
}

// 3. Submit seed
const hash = await walletClient.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'submitSeed',
  args: [ipfsHash]
});

// 4. Wait for confirmation and get seed ID
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const seedSubmittedLog = receipt.logs.find(log => {
  // Find SeedSubmitted event
  return log.topics[0] === '0x...SEED_SUBMITTED_EVENT_HASH';
});

const seedId = Number(seedSubmittedLog.topics[1]);
console.log(`✅ Seed ${seedId} submitted!`);

// 5. Fetch complete seed info
const seed = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getSeed',
  args: [seedId]
});

console.log({
  id: Number(seed.id),
  creator: seed.creator,
  ipfsHash: seed.ipfsHash,
  round: Number(seed.submittedInRound),
  blessings: Number(seed.blessings)
});
```

---

### Complete Blessing Flow (User-Signed)
```typescript
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

// 1. Get your NFT ownership data
const userAddress = account.address.toLowerCase();

// Fetch from API or generate locally
const response = await fetch(`${API_URL}/blessings/firstworks/snapshot`);
const snapshot = await response.json();

const tokenIds = snapshot.data.holderIndex[userAddress] || [];

if (tokenIds.length === 0) {
  throw new Error('You do not own any FirstWorks NFTs');
}

// 2. Load merkle tree and generate proof
const merkleData = await fetch(`${API_URL}/merkle-tree`).then(r => r.json());
const proof = merkleData.proofs[userAddress] || [];

console.log(`You own ${tokenIds.length} NFTs, generating proof...`);

// 3. Check remaining blessings
const usedToday = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getUserDailyBlessingCount',
  args: [account.address]
});

const maxBlessings = tokenIds.length * 1; // 1 blessing per NFT
const remaining = maxBlessings - Number(usedToday);

console.log(`Remaining blessings today: ${remaining}/${maxBlessings}`);

if (remaining === 0) {
  throw new Error('No blessings remaining today');
}

// 4. Check if voting period is active
const timeRemaining = await publicClient.readContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'getTimeUntilPeriodEnd'
});

if (timeRemaining === 0n) {
  throw new Error('Voting period has ended');
}

// 5. Bless the seed
const seedId = 42;

const hash = await walletClient.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'blessSeed',
  args: [
    seedId,
    tokenIds,
    proof
  ]
});

console.log(`Blessing transaction submitted: ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });

if (receipt.status === 'success') {
  console.log(`✅ Blessed seed ${seedId}!`);

  // Get updated seed info
  const seed = await publicClient.readContract({
    address: SEEDS_CONTRACT_ADDRESS,
    abi: theSeedsABI,
    functionName: 'getSeed',
    args: [seedId]
  });

  console.log(`Seed now has ${seed.blessings} blessings`);
}
```

---

### Gasless Blessing Flow (Backend-Signed)
```typescript
// Frontend: Approve backend as delegate (one-time setup)
const BACKEND_RELAYER = '0x...'; // Backend wallet address

// Step 1: Approve delegate
const approveHash = await walletClient.writeContract({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  functionName: 'approveDelegate',
  args: [BACKEND_RELAYER, true]
});

await publicClient.waitForTransactionReceipt({ hash: approveHash });
console.log('✅ Backend approved for gasless blessings');

// Step 2: Call API to perform gasless blessing
const response = await fetch(`${API_URL}/blessings`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${privyAuthToken}`
  },
  body: JSON.stringify({
    seedId: 42
  })
});

const result = await response.json();

if (result.success) {
  console.log(`✅ Gasless blessing successful!`);
  console.log(`TX: ${result.data.txHash}`);
  console.log(`Remaining: ${result.data.remainingBlessings}`);
}
```

---

### Query Current Competition State
```typescript
// Get comprehensive round info
async function getRoundInfo() {
  const [
    currentRound,
    timeRemaining,
    seeds,
    [leaderIds, leaderScore],
    eligibleCount
  ] = await Promise.all([
    publicClient.readContract({
      address: SEEDS_CONTRACT_ADDRESS,
      abi: theSeedsABI,
      functionName: 'currentRound'
    }),
    publicClient.readContract({
      address: SEEDS_CONTRACT_ADDRESS,
      abi: theSeedsABI,
      functionName: 'getTimeUntilPeriodEnd'
    }),
    publicClient.readContract({
      address: SEEDS_CONTRACT_ADDRESS,
      abi: theSeedsABI,
      functionName: 'getCurrentRoundSeeds'
    }),
    publicClient.readContract({
      address: SEEDS_CONTRACT_ADDRESS,
      abi: theSeedsABI,
      functionName: 'getCurrentLeaders'
    }),
    publicClient.readContract({
      address: SEEDS_CONTRACT_ADDRESS,
      abi: theSeedsABI,
      functionName: 'getEligibleSeedsCount'
    })
  ]);

  const hoursRemaining = Number(timeRemaining) / 3600;

  return {
    round: Number(currentRound),
    timeRemaining: `${hoursRemaining.toFixed(1)} hours`,
    seedCount: seeds.length,
    leaders: leaderIds.map(id => Number(id)),
    leaderScore: Number(leaderScore) / 1e6, // Unscale
    eligibleCount: Number(eligibleCount),
    votingEnded: timeRemaining === 0n
  };
}

// Usage
const info = await getRoundInfo();
console.log(`
Round ${info.round}
Seeds: ${info.seedCount}
Leaders: ${info.leaders.join(', ')}
Score: ${info.leaderScore.toFixed(2)}
Time: ${info.timeRemaining}
`);
```

---

### Admin: Select Winner and Handle Errors
```typescript
async function selectWinnerWithDiagnostics() {
  // 1. Run pre-flight checks
  const [round, seeds, timeRemaining, [leaderIds, score]] = await Promise.all([
    publicClient.readContract({
      address: SEEDS_CONTRACT_ADDRESS,
      abi: theSeedsABI,
      functionName: 'currentRound'
    }),
    publicClient.readContract({
      address: SEEDS_CONTRACT_ADDRESS,
      abi: theSeedsABI,
      functionName: 'getCurrentRoundSeeds'
    }),
    publicClient.readContract({
      address: SEEDS_CONTRACT_ADDRESS,
      abi: theSeedsABI,
      functionName: 'getTimeUntilPeriodEnd'
    }),
    publicClient.readContract({
      address: SEEDS_CONTRACT_ADDRESS,
      abi: theSeedsABI,
      functionName: 'getCurrentLeaders'
    })
  ]);

  console.log('Pre-flight Diagnostics:');
  console.log(`  Round: ${round}`);
  console.log(`  Seeds: ${seeds.length}`);
  console.log(`  Time Remaining: ${timeRemaining}s`);
  console.log(`  Leaders: ${leaderIds.map(id => Number(id))}`);
  console.log(`  Score: ${score}`);

  // 2. Check for issues
  if (timeRemaining > 0n) {
    throw new Error(`Voting period not ended (${timeRemaining}s remaining)`);
  }

  if (seeds.length === 0) {
    throw new Error('No seeds in current round');
  }

  if (score === 0n) {
    throw new Error('No seed has blessing score > 0');
  }

  const eligibleSeeds = seeds.filter(s => !s.isWinner && !s.isRetracted);
  if (eligibleSeeds.length === 0) {
    throw new Error('All seeds already won');
  }

  console.log('✅ Pre-flight checks passed');

  // 3. Select winner
  try {
    const hash = await walletClient.writeContract({
      address: SEEDS_CONTRACT_ADDRESS,
      abi: theSeedsABI,
      functionName: 'selectDailyWinner'
    });

    console.log(`Winner selection TX: ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    // Parse winner from events
    const winnerLog = receipt.logs.find(log =>
      log.topics[0] === WINNER_SELECTED_EVENT_HASH
    );

    const winningSeedId = Number(winnerLog.topics[2]);

    console.log(`✅ Winner selected: Seed ${winningSeedId}`);

    return {
      success: true,
      seedId: winningSeedId,
      txHash: hash,
      round: Number(round)
    };
  } catch (error) {
    console.error('Winner selection failed:', error);

    // Parse specific errors
    if (error.message.includes('NoValidWinner')) {
      throw new Error('Contract could not find a valid winner');
    } else if (error.message.includes('VotingPeriodNotEnded')) {
      throw new Error('Voting period not ended yet');
    }

    throw error;
  }
}

// Usage
try {
  const result = await selectWinnerWithDiagnostics();
  console.log(`Winner selected in round ${result.round}: Seed ${result.seedId}`);
} catch (error) {
  console.error('Failed to select winner:', error.message);
}
```

---

### Listening to Events
```typescript
import { parseAbiItem } from 'viem';

// Watch for new seed submissions
const unwatchSeeds = publicClient.watchContractEvent({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  eventName: 'SeedSubmitted',
  onLogs: logs => {
    for (const log of logs) {
      const { seedId, creator, ipfsHash } = log.args;
      console.log(`New seed ${seedId} by ${creator}`);
      console.log(`IPFS: ${ipfsHash}`);
    }
  }
});

// Watch for blessings
const unwatchBlessings = publicClient.watchContractEvent({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  eventName: 'BlessingSubmitted',
  onLogs: logs => {
    for (const log of logs) {
      const { seedId, blesser, actor, isDelegated } = log.args;
      console.log(`${blesser} blessed seed ${seedId}`);
      if (isDelegated) {
        console.log(`  (via delegate ${actor})`);
      }
    }
  }
});

// Watch for winners
const unwatchWinners = publicClient.watchContractEvent({
  address: SEEDS_CONTRACT_ADDRESS,
  abi: theSeedsABI,
  eventName: 'WinnerSelected',
  onLogs: logs => {
    for (const log of logs) {
      const { round, seedId, score, blessings } = log.args;
      console.log(`🏆 Round ${round} winner: Seed ${seedId}`);
      console.log(`   Blessings: ${blessings}, Score: ${score}`);
    }
  }
});

// Clean up when done
// unwatchSeeds();
// unwatchBlessings();
// unwatchWinners();
```

---

## Additional Resources

- [Main README](../README.md) - Project overview and architecture
- [API Reference](./API_REFERENCE.md) - REST API endpoints
- [Smart Contract Guide](../SMART_CONTRACT_GUIDE.md) - High-level contract overview
- [Sqrt Scoring Explained](../SQRT_SCORING_EXPLAINED.md) - Anti-whale mechanism details
- [Auto Elevation Guide](../AUTO_ELEVATION_GUIDE.md) - Winner elevation flow

---

## Support

For issues or questions:
- GitHub Issues: https://github.com/yourusername/abraham-api/issues
- Contract on Base: [View on BaseScan](https://basescan.org/address/SEEDS_CONTRACT_ADDRESS)
