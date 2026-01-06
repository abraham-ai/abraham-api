# Cross-Chain Architecture Design

## Overview

This document outlines the architecture for a cross-chain NFT governance system spanning Ethereum L1 and Base L2, enabling decentralized curation of daily NFT mints.

## System Components

### L1 Contracts (Ethereum Mainnet)

#### 1. Abraham's First Works

- **Type:** Standard ERC-721
- **Supply:** 2,500 NFTs (fully minted)
- **Purpose:** Voting rights token for governance
- **Key Features:**
  - Fully transferable
  - Each token = 1 vote on L2
  - Votes automatically follow ownership (no staking required)

#### 2. Abraham Covenant

- **Type:** Time-gated ERC-721
- **Supply:** 4,074 NFTs (1 per day for 4,074 days)
- **Purpose:** Daily NFT minting based on L2 governance decisions
- **Key Features:**
  - Only 1 mint per day enforced by contract
  - Minting authority: Initially Abraham's wallet, later delegated to L2 bridge
  - Token URI determined by winning Seed from L2
  - Cannot transfer minting rights, only execute scheduled mints

### L2 Contract (Base)

#### 3. The Seeds Contract

- **Type:** Governance + NFT metadata registry
- **Purpose:** Manage Seeds (proposed artworks) and voting
- **Key Features:**
  - Seed submission system
  - Voting mechanism based on L1 NFT ownership
  - Daily vote tallying
  - Winner selection and L1 mint triggering

## Cross-Chain Architecture

### Recommended Approach: Hybrid Solution

Given the constraints (daily cadence, trust minimization, reasonable UX), I recommend a **hybrid architecture**:

#### For L1→L2 (Ownership Verification)

**Solution: Snapshot + Storage Proofs**

```
┌─────────────────┐
│   L1: FirstWorks│
│   ERC-721       │
└────────┬────────┘
         │
         │ 1. Daily snapshot
         │    (off-chain indexer)
         ▼
┌─────────────────┐
│  Snapshot       │◄────┐
│  (Backend)      │     │
└────────┬────────┘     │
         │              │
         │ 2. Merkle    │
         │    root      │
         ▼              │
┌─────────────────┐     │
│  L2: Seeds      │     │
│  Contract       │     │
└────────┬────────┘     │
         │              │
         │ 3. User      │
         │    proves    │
         │    ownership │
         └──────────────┘
```

**How it works:**

1. Daily snapshot of FirstWorks ownership (already implemented in your API!)
2. Generate Merkle tree of ownership
3. Post Merkle root to L2 Seeds contract
4. Users submit Merkle proofs to vote
5. Votes are valid as long as ownership proof is valid

**Pros:**

- Leverages existing snapshot infrastructure
- Gas efficient on L2
- No need to "register" or "stake" NFTs
- Trustless ownership verification

**Cons:**

- 24-hour delay for ownership changes to reflect
- Requires off-chain Merkle tree generation

#### For L2→L1 (Mint Triggering)

**Solution: Trusted Relayer with Optimistic Oracle**

```
┌─────────────────┐
│  L2: Seeds      │
│  Contract       │
└────────┬────────┘
         │
         │ 1. Emit WinnerSelected
         │    event with Seed URI
         ▼
┌─────────────────┐
│  Relayer        │
│  (Backend)      │◄────┐
└────────┬────────┘     │
         │              │
         │ 2. Call      │ 4. Challenge
         │    mint()    │    (if fraud)
         ▼              │
┌─────────────────┐     │
│  L1: Covenant   │     │
│  Contract       │     │
└────────┬────────┘     │
         │              │
         │ 3. Record    │
         │    mint      │
         └──────────────┘
```

**How it works:**

1. L2 Seeds contract determines daily winner
2. Emits `WinnerSelected(seedId, ipfsURI, merkleProof)` event
3. Trusted relayer calls `mint()` on L1 Covenant
4. L1 contract verifies:
   - Only 1 mint per day
   - Relayer is authorized
   - Includes fraud-proof period
5. Community can challenge fraudulent mints

**Pros:**

- Fast execution (no 7-day withdrawal period)
- Simple implementation
- Gas efficient
- Can be decentralized later

**Cons:**

- Initial trust assumption on relayer
- Need fraud-proof mechanism

### Alternative Approaches Considered

#### 1. Canonical OP-Stack Messaging

**L1→L2:** `L1CrossDomainMessenger`
**L2→L1:** `L2CrossDomainMessenger`

**Rejected because:**

- L2→L1 messages have 7-day withdrawal period
- Too slow for daily minting cadence
- Over-engineered for this use case

#### 2. LayerZero / Chainlink CCIP

**Pros:** Fast, flexible, cross-chain messaging
**Cons:** Additional cost, complexity, and external dependencies

#### 3. Full Storage Proofs (no snapshots)

**Pros:** Fully trustless, real-time ownership
**Cons:** Very expensive gas costs, complex implementation

## Detailed Contract Design

### 1. Abraham's First Works (L1)

```solidity
// Standard ERC-721, already deployed at:
// 0x8F814c7C75C5E9e0EDe0336F535604B1915C1985
```

No changes needed - this contract already exists.

### 2. Abraham Covenant (L1)

```solidity
contract AbrahamCovenant is ERC721 {
    uint256 public constant MAX_SUPPLY = 4074;
    uint256 public constant MINT_INTERVAL = 1 days;

    address public authorizedMinter; // Can be relayer
    uint256 public mintStartTime;
    uint256 public nextMintIndex;
    mapping(uint256 => uint256) public mintTimestamps;

    // Fraud protection
    mapping(uint256 => bytes32) public seedProofs;
    uint256 public constant CHALLENGE_PERIOD = 6 hours;

    function mint(
        address to,
        string memory tokenURI,
        bytes32 seedProof
    ) external onlyAuthorizedMinter {
        require(nextMintIndex < MAX_SUPPLY, "All minted");
        require(
            block.timestamp >= mintStartTime + (nextMintIndex * MINT_INTERVAL),
            "Too early"
        );

        uint256 tokenId = nextMintIndex++;
        mintTimestamps[tokenId] = block.timestamp;
        seedProofs[tokenId] = seedProof;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);

        emit Minted(tokenId, to, tokenURI, seedProof);
    }

    function challengeMint(uint256 tokenId, bytes memory proof) external {
        require(
            block.timestamp <= mintTimestamps[tokenId] + CHALLENGE_PERIOD,
            "Challenge period ended"
        );
        // Challenge logic
    }
}
```

### 3. The Seeds Contract (L2)

```solidity
contract TheSeeds {
    // Seed management
    struct Seed {
        uint256 id;
        address creator;
        string ipfsHash;
        uint256 votes;
        uint256 createdAt;
        bool minted;
    }

    mapping(uint256 => Seed) public seeds;
    uint256 public seedCount;

    // Voting system (Merkle-based)
    bytes32 public currentOwnershipRoot;
    uint256 public rootTimestamp;
    mapping(address => mapping(uint256 => uint256)) public votedForSeed;

    // Daily voting period
    uint256 public votingPeriodStart;
    uint256 public constant VOTING_PERIOD = 1 days;

    // Owner can update Merkle root (from off-chain snapshot)
    function updateOwnershipRoot(bytes32 newRoot) external onlyOwner {
        currentOwnershipRoot = newRoot;
        rootTimestamp = block.timestamp;
        emit OwnershipRootUpdated(newRoot, block.timestamp);
    }

    // Submit a new Seed
    function submitSeed(string memory ipfsHash) external {
        uint256 seedId = seedCount++;
        seeds[seedId] = Seed({
            id: seedId,
            creator: msg.sender,
            ipfsHash: ipfsHash,
            votes: 0,
            createdAt: block.timestamp,
            minted: false
        });

        emit SeedSubmitted(seedId, msg.sender, ipfsHash);
    }

    // Vote for a Seed (requires Merkle proof of FirstWorks ownership)
    function voteForSeed(
        uint256 seedId,
        uint256[] memory tokenIds,
        bytes32[] memory merkleProof
    ) external {
        require(seeds[seedId].createdAt > 0, "Seed not found");

        // Verify Merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, tokenIds));
        require(
            MerkleProof.verify(merkleProof, currentOwnershipRoot, leaf),
            "Invalid proof"
        );

        // Update votes
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];
            uint256 previousVote = votedForSeed[msg.sender][tokenId];

            if (previousVote != 0 && previousVote != seedId) {
                seeds[previousVote].votes--;
            }

            if (previousVote != seedId) {
                seeds[seedId].votes++;
                votedForSeed[msg.sender][tokenId] = seedId;
            }
        }

        emit VoteCast(msg.sender, seedId, tokenIds.length);
    }

    // Tally votes and select winner (called by backend/relayer)
    function selectDailyWinner() external returns (uint256 winningSeedId) {
        require(
            block.timestamp >= votingPeriodStart + VOTING_PERIOD,
            "Voting period not ended"
        );

        // Find seed with most votes
        uint256 maxVotes = 0;
        uint256 winnerSeedId = 0;

        for (uint256 i = 0; i < seedCount; i++) {
            if (seeds[i].votes > maxVotes && !seeds[i].minted) {
                maxVotes = seeds[i].votes;
                winnerSeedId = i;
            }
        }

        require(maxVotes > 0, "No votes cast");

        seeds[winnerSeedId].minted = true;
        votingPeriodStart = block.timestamp;

        emit WinnerSelected(winnerSeedId, seeds[winnerSeedId].ipfsHash, maxVotes);

        return winnerSeedId;
    }
}
```

## Implementation Phases

### Phase 1: Core Contracts (Week 1-2)

- [ ] Deploy Abraham Covenant on mainnet testnet (Sepolia)
- [ ] Deploy The Seeds on Base testnet (Base Sepolia)
- [ ] Implement basic minting and voting

### Phase 2: Snapshot Integration (Week 2-3)

- [ ] Extend existing snapshot system to generate Merkle trees
- [ ] Add Merkle root posting to L2
- [ ] Implement Merkle proof generation API

### Phase 3: Relayer Infrastructure (Week 3-4)

- [ ] Build relayer service to monitor L2 events
- [ ] Implement automatic L1 minting
- [ ] Add fraud detection and alerting

### Phase 4: Testing & Audit (Week 4-6)

- [ ] Comprehensive test suite
- [ ] Gas optimization
- [ ] Security audit
- [ ] Testnet deployment and testing

### Phase 5: Mainnet Deployment (Week 6+)

- [ ] Deploy to mainnet
- [ ] Gradually decentralize relayer (multisig)
- [ ] Monitor and iterate

## Security Considerations

### Trust Assumptions

1. **Snapshot Generator:** Trusted to generate accurate Merkle roots

   - Mitigation: Open source, verifiable
   - Future: Multiple independent snapshot providers

2. **Relayer:** Trusted to relay correct winner
   - Mitigation: Challenge period, fraud proofs
   - Future: Decentralized relayer network

### Attack Vectors

#### 1. Merkle Proof Forgery

- **Risk:** User submits fake ownership proof
- **Mitigation:** Cryptographic verification on-chain

#### 2. Relayer Fraud

- **Risk:** Relayer mints wrong Seed
- **Mitigation:** 6-hour challenge period, fraud proofs

#### 3. Vote Manipulation

- **Risk:** Wash trading FirstWorks to accumulate votes
- **Mitigation:** 24-hour snapshot delay makes this expensive

#### 4. Frontrunning

- **Risk:** See winning Seed, buy it before announcement
- **Mitigation:** Seeds are submitted publicly; no pre-reveal needed

## Gas Optimization

### L1 (Expensive)

- Minimal storage
- Batch operations where possible
- Use events for data availability

### L2 (Cheap)

- More complex voting logic acceptable
- Store full Seed metadata
- Rich events for indexing

## Future Enhancements

### Decentralization Roadmap

1. **Phase 1:** Single trusted relayer (launch)
2. **Phase 2:** Multisig relayer (3-of-5)
3. **Phase 3:** Decentralized relayer network with incentives
4. **Phase 4:** Fully trustless with ZK proofs

### Additional Features

- Seed NFTs on L2 (trade Seeds before minting)
- Delegation (lend voting power)
- Quadratic voting
- Seed curation bonuses
- Community treasury from Covenant sales

---

## v2.0 Features: Commandments & Configuration (2026-01-06)

### Commandments System

**Purpose:** Enable perpetual discussion and commentary on seeds

```
┌─────────────────────────────────────────────────────────┐
│                    The Seeds Contract                    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Blessings (Votes)           Commandments (Comments)    │
│  ├─ Time-restricted         ├─ Perpetual               │
│  ├─ Affects scoring         ├─ No score impact*        │
│  ├─ Voting period only      ├─ Anytime, any seed       │
│  └─ Daily limit: 1/NFT      └─ Daily limit: 1/NFT      │
│                                                          │
│  * Can be enabled via scoringConfig.commandmentWeight   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Key Design Decisions:**
- **No Time Restrictions:** Can comment on any seed (current, past, or winners)
- **Separate Daily Limits:** 2 NFTs = 2 blessings/day AND 2 commandments/day
- **IPFS Storage:** Comments stored on IPFS, hashes on-chain
- **Event-Based Retrieval:** Uses `CommandmentSubmitted` events for scalability
- **Same Auth:** Uses same Merkle proof + delegation system as blessings

**Data Flow:**
```
User submits commandment
      │
      ├─ Verify NFT ownership (Merkle proof)
      ├─ Check daily limit
      ├─ Upload to IPFS (backend)
      ├─ Submit IPFS hash to contract
      └─ Emit CommandmentSubmitted event

API retrieves commandments
      │
      ├─ Index CommandmentSubmitted events
      ├─ Filter by seedId/user/timeframe
      ├─ Fetch IPFS metadata
      └─ Return enriched data
```

### Configurable Economics

**Purpose:** Flexible pricing and scoring for sustainable governance

#### Cost Configuration

```
┌─────────────────────────────────────────────────────────┐
│                   Cost Management                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Blessing Cost: 0 ETH → configurable                    │
│  Commandment Cost: 0 ETH → configurable                 │
│                                                          │
│  Treasury: Deployer address → configurable              │
│  Fee Withdrawal: Admin-only, to treasury                │
│                                                          │
│  Deferred Updates: Applied at round end                 │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Admin Functions:**
- `updateBlessingCost(uint256 newCost)` - Set blessing price
- `updateCommandmentCost(uint256 newCost)` - Set commandment price
- `updateTreasury(address newTreasury)` - Change fee recipient
- `withdrawFees()` - Transfer collected fees to treasury

**Economic Flow:**
```
User Action → Payment → Contract Balance → Admin Withdrawal → Treasury
```

#### Scoring Configuration

```
┌─────────────────────────────────────────────────────────┐
│                  Scoring Parameters                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Blessing Weight: 1000 (1.0x) → configurable            │
│  Commandment Weight: 0 (disabled) → configurable        │
│  Time Decay Min: 10 → configurable                      │
│  Time Decay Base: 1000 → configurable                   │
│                                                          │
│  Deferred Updates: Applied at round end                 │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Admin Function:**
- `updateScoringConfig(blessingWeight, commandmentWeight, timeDecayMin, timeDecayBase)`

**Future Possibilities:**
- Enable commandment scoring (set weight > 0)
- Adjust blessing vs commandment impact ratio
- Fine-tune time decay for different dynamics

### Contract Size Optimization

**Challenge:** Contract exceeded 24.5 KB limit (26.4 KB)

**Solution:** Event-based indexing instead of view functions

**Removed Functions:**
```
❌ getCommandmentsBySeed(seedId)
   → ✅ Filter CommandmentSubmitted events

❌ getCurrentLeaders()
   → ✅ Calculate from seed data off-chain

❌ getSeedsByRound(round)
   → ✅ Filter SeedSubmitted events

❌ getCurrentRoundSeeds()
   → ✅ Use event-based getSeedsByRound
```

**Results:**
- Contract size: 26.4 KB → 23.6 KB (10.6% reduction)
- Under limit by: 977 bytes (4.0% buffer)
- Gas savings: Array construction moved off-chain
- Scalability: Better handling of large datasets

### API Architecture Updates

```
┌─────────────────────────────────────────────────────────┐
│                    API Service Layer                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  contractService.ts                                      │
│  ├─ Event-based data retrieval                          │
│  ├─ Caching (5-min TTL for events)                      │
│  ├─ Batch event fetching (50k blocks)                   │
│  └─ Parallel IPFS metadata enrichment                   │
│                                                          │
│  commandmentService.ts (NEW)                             │
│  ├─ IPFS upload (Vercel Blob)                           │
│  ├─ Merkle proof generation                             │
│  ├─ Gasless submission (relayer)                        │
│  └─ Stats and eligibility checks                        │
│                                                          │
│  ipfsService.ts (NEW)                                    │
│  ├─ Content hash generation                             │
│  ├─ Vercel Blob upload                                  │
│  ├─ Metadata fetching                                   │
│  └─ Hash to URL conversion                              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**New Endpoints:**
```
POST   /api/commandments                    - Submit commandment
GET    /api/commandments/seed/:seedId       - Get seed's commandments
GET    /api/commandments/user/:address      - Get user's commandments
GET    /api/commandments/stats              - Get user stats
GET    /api/commandments/eligibility        - Check if can comment
GET    /api/commandments/all                - Get all commandments

POST   /api/admin/update-blessing-cost      - Update blessing cost
POST   /api/admin/update-commandment-cost   - Update commandment cost
POST   /api/admin/update-scoring-config     - Update scoring weights
POST   /api/admin/withdraw-fees             - Withdraw collected fees
```

### Security Enhancements

**Deferred Configuration Updates:**
- Costs and scoring updates applied at round end
- Prevents mid-round manipulation
- Ensures fair gameplay for all participants

**Payment Security:**
- Overpayment refund mechanism
- Reentrancy protection (`nonReentrant`)
- Treasury withdrawal requires admin role
- Solidity 0.8+ overflow protection

**Access Control:**
- Role-based permissions (ADMIN_ROLE, RELAYER_ROLE, CREATOR_ROLE)
- Delegate approval system (same as blessings)
- Merkle proof verification (prevents fake NFT claims)

**Rate Limiting:**
- Independent daily limits for blessings and commandments
- Per-NFT limits prevent spam
- Daily reset mechanism (UTC-based)

### Deployment Workflow

```
1. Deploy Contract
   ├─ Default: free blessings, free commandments
   ├─ Commandment scoring disabled (weight = 0)
   └─ Treasury = deployer address

2. Initial Configuration (Optional)
   ├─ Update treasury address
   ├─ Set blessing/commandment costs
   ├─ Adjust daily limits
   └─ Configure scoring weights

3. Grant Roles
   ├─ RELAYER_ROLE → Backend (for gasless txns)
   └─ CREATOR_ROLE → Backend (for seed creation)

4. Update Merkle Root
   ├─ Generate from FirstWorks snapshot
   └─ Post to contract

5. Monitor & Maintain
   ├─ Daily snapshot updates
   ├─ Periodic fee withdrawal
   └─ Configuration adjustments as needed
```

### Future Architecture Considerations

**Potential Enhancements:**

1. **Commandment Scoring**
   - Enable by setting `commandmentWeight > 0`
   - Weight insightful discussion
   - Negative weights for critical commentary

2. **Dynamic Pricing**
   - Automatic cost adjustment based on demand
   - Surge pricing during high activity
   - Discounts for consistent participants

3. **Nested Commandments**
   - Reply to commandments
   - Thread-based discussions
   - Recursive data structures

4. **Reputation System**
   - Weight votes by user reputation
   - Reward quality commentary
   - Slash malicious actors

5. **Commandment NFTs**
   - Mint exceptional commandments as NFTs
   - Tradeable commentary
   - Curator rewards

## Conclusion

This hybrid architecture balances:

- **Trust minimization:** Merkle proofs for ownership
- **UX:** Fast voting on L2, no staking required
- **Cost:** Leverage existing snapshot infra
- **Speed:** Daily cadence without 7-day delays

The system can launch with trust assumptions (relayer) and gradually decentralize over time.
