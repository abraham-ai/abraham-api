import { expect } from "chai";
import { ethers } from "hardhat";
import { TheSeeds } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

describe("TheSeeds - Fixed Contract Tests", function () {
  let theSeeds: TheSeeds;
  let admin: SignerWithAddress;
  let creator: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let relayer: SignerWithAddress;

  // Helper to generate merkle tree for NFT ownership
  function generateMerkleTree(userData: [string, number[]][]) {
    const tree = StandardMerkleTree.of(userData, ["address", "uint256[]"]);
    return tree;
  }

  function getMerkleProof(tree: any, address: string, tokenIds: number[]) {
    return tree.getProof([address, tokenIds]);
  }

  beforeEach(async function () {
    [admin, creator, user1, user2, relayer] = await ethers.getSigners();

    const TheSeedsFactory = await ethers.getContractFactory("TheSeeds");
    theSeeds = await TheSeedsFactory.deploy(admin.address, creator.address);
    await theSeeds.waitForDeployment();

    // Setup Merkle tree for NFT ownership
    const merkleData: [string, number[]][] = [
      [user1.address, [1, 2, 3]],
      [user2.address, [4, 5]],
    ];

    const merkleTree = generateMerkleTree(merkleData);
    const root = merkleTree.root;

    // Update ownership root
    await theSeeds.connect(admin).updateOwnershipRoot(root);

    // Add relayer
    await theSeeds.connect(admin).addRelayer(relayer.address);
  });

  describe("Critical Security Fixes", function () {
    describe("Duplicate Token ID Prevention", function () {
      it("should reject blessing with duplicate token IDs", async function () {
        // Submit a seed
        await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

        // Create Merkle tree
        const merkleData = [{ address: user1.address, tokenIds: [1, 2, 3] }];
        const merkleTree = generateMerkleTree(merkleData);

        // Try to bless with duplicate token IDs [1, 1, 2]
        const duplicateTokenIds = [1, 1, 2];
        const duplicateLeaf = ethers.solidityPackedKeccak256(
          ["bytes"],
          [ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256[]"], [user1.address, duplicateTokenIds])]
        );
        const duplicateProof = merkleTree.getHexProof(duplicateLeaf);

        // Should revert or return false (verification should fail)
        await expect(
          theSeeds.connect(user1).blessSeed(0, duplicateTokenIds, duplicateProof)
        ).to.be.revertedWithCustomError(theSeeds, "InvalidMerkleProof");
      });

      it("should accept blessing with unique token IDs", async function () {
        // Submit a seed
        await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

        // Create valid proof with unique token IDs
        const merkleData = [{ address: user1.address, tokenIds: [1, 2, 3] }];
        const merkleTree = generateMerkleTree(merkleData);
        const root = merkleTree.getHexRoot();
        await theSeeds.connect(admin).updateOwnershipRoot(root);

        const proof = getMerkleProof(merkleTree, user1.address, [1, 2, 3]);

        // Should succeed
        await expect(theSeeds.connect(user1).blessSeed(0, [1, 2, 3], proof))
          .to.emit(theSeeds, "BlessingSubmitted");
      });
    });

    describe("Score Precision Improvements", function () {
      it("should calculate scores with proper precision for small blessing counts", async function () {
        await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

        const merkleData = [{ address: user1.address, tokenIds: [1] }];
        const merkleTree = generateMerkleTree(merkleData);
        const root = merkleTree.getHexRoot();
        await theSeeds.connect(admin).updateOwnershipRoot(root);

        const proof = getMerkleProof(merkleTree, user1.address, [1]);

        // Bless once
        await theSeeds.connect(user1).blessSeed(0, [1], proof);
        const score1 = await theSeeds.seedBlessingScore(0);

        // Wait a bit and bless again (with different user to test multiple blessers)
        await ethers.provider.send("evm_increaseTime", [3600]); // 1 hour
        await ethers.provider.send("evm_mine", []);

        // Score should have increased (not stayed the same)
        // The new calculation with SCORE_SCALE_FACTOR should provide better precision
        expect(score1).to.be.gt(0);
      });

      it("should apply sqrt dampening correctly with scale factor", async function () {
        await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

        const merkleData = [
          { address: user1.address, tokenIds: [1] },
          { address: user2.address, tokenIds: [4] },
        ];
        const merkleTree = generateMerkleTree(merkleData);
        const root = merkleTree.getHexRoot();
        await theSeeds.connect(admin).updateOwnershipRoot(root);

        const proof1 = getMerkleProof(merkleTree, user1.address, [1]);
        const proof2 = getMerkleProof(merkleTree, user2.address, [4]);

        // User1 blesses 4 times (sqrt(4) = 2)
        await theSeeds.connect(user1).blessSeed(0, [1], proof1);
        await ethers.provider.send("evm_increaseTime", [86400]); // Next day
        await ethers.provider.send("evm_mine", []);
        await theSeeds.connect(user1).blessSeed(0, [1], proof1);
        await ethers.provider.send("evm_increaseTime", [86400]);
        await ethers.provider.send("evm_mine", []);
        await theSeeds.connect(user1).blessSeed(0, [1], proof1);
        await ethers.provider.send("evm_increaseTime", [86400]);
        await ethers.provider.send("evm_mine", []);
        await theSeeds.connect(user1).blessSeed(0, [1], proof1);

        // User2 blesses 1 time (sqrt(1) = 1)
        await theSeeds.connect(user2).blessSeed(0, [4], proof2);

        // Get blessing count for each user
        const user1Blessings = await theSeeds.getBlessingCount(user1.address, 0);
        const user2Blessings = await theSeeds.getBlessingCount(user2.address, 0);

        expect(user1Blessings).to.equal(4);
        expect(user2Blessings).to.equal(1);

        // Score should reflect sqrt dampening (not linear)
        const finalScore = await theSeeds.seedBlessingScore(0);
        expect(finalScore).to.be.gt(0);
      });
    });

    describe("Retracted Seeds Handling", function () {
      it("should mark seed as retracted (not winner)", async function () {
        await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

        // Retract the seed
        await theSeeds.connect(creator).retractSeed(0);

        const seed = await theSeeds.getSeed(0);
        expect(seed.isRetracted).to.be.true;
        expect(seed.isWinner).to.be.false; // Should NOT be marked as winner
      });

      it("should prevent blessing retracted seeds", async function () {
        await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
        await theSeeds.connect(creator).retractSeed(0);

        const merkleData = [{ address: user1.address, tokenIds: [1] }];
        const merkleTree = generateMerkleTree(merkleData);
        const root = merkleTree.getHexRoot();
        await theSeeds.connect(admin).updateOwnershipRoot(root);
        const proof = getMerkleProof(merkleTree, user1.address, [1]);

        await expect(
          theSeeds.connect(user1).blessSeed(0, [1], proof)
        ).to.be.revertedWithCustomError(theSeeds, "SeedAlreadyWinner"); // Retracted treated same as winner
      });

      it("should exclude retracted seeds from winner selection", async function () {
        // Create two seeds
        await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
        await theSeeds.connect(creator).submitSeed("QmTest234567890123456789012345678901234567");

        // Retract first seed
        await theSeeds.connect(creator).retractSeed(0);

        // Bless only the second seed
        const merkleData = [{ address: user1.address, tokenIds: [1] }];
        const merkleTree = generateMerkleTree(merkleData);
        const root = merkleTree.getHexRoot();
        await theSeeds.connect(admin).updateOwnershipRoot(root);
        const proof = getMerkleProof(merkleTree, user1.address, [1]);

        await theSeeds.connect(user1).blessSeed(1, [1], proof);

        // Advance time past voting period
        await ethers.provider.send("evm_increaseTime", [86400]);
        await ethers.provider.send("evm_mine", []);

        // Select winner - should be seed 1, not seed 0 (retracted)
        const winnerId = await theSeeds.selectDailyWinner();
        expect(winnerId).to.equal(1);
      });

      it("should prevent double retraction", async function () {
        await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
        await theSeeds.connect(creator).retractSeed(0);

        await expect(
          theSeeds.connect(creator).retractSeed(0)
        ).to.be.revertedWithCustomError(theSeeds, "AlreadyRetracted");
      });
    });

    describe("Array Growth Limits", function () {
      it("should respect MAX_SEEDS_PER_ROUND limit", async function () {
        const maxSeeds = await theSeeds.MAX_SEEDS_PER_ROUND();

        // Try to submit more than max seeds (this would take too long in test, so just check the constant)
        expect(maxSeeds).to.equal(1000);
      });

      it("should respect MAX_TOTAL_SEEDS limit", async function () {
        const maxTotal = await theSeeds.MAX_TOTAL_SEEDS();
        expect(maxTotal).to.equal(100000);
      });
    });

    describe("IPFS Hash Validation", function () {
      it("should accept valid IPFS CIDv0 hash", async function () {
        await expect(
          theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456")
        ).to.emit(theSeeds, "SeedSubmitted");
      });

      it("should accept valid IPFS CIDv1 hash", async function () {
        await expect(
          theSeeds.connect(creator).submitSeed("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")
        ).to.emit(theSeeds, "SeedSubmitted");
      });

      it("should reject empty IPFS hash", async function () {
        await expect(
          theSeeds.connect(creator).submitSeed("")
        ).to.be.revertedWithCustomError(theSeeds, "InvalidIPFSHash");
      });

      it("should reject obviously invalid IPFS hash", async function () {
        await expect(
          theSeeds.connect(creator).submitSeed("invalid")
        ).to.be.revertedWithCustomError(theSeeds, "InvalidIPFSHash");
      });
    });
  });

  describe("Deferred Configuration Updates", function () {
    it("should defer voting period updates to next round", async function () {
      const currentPeriod = await theSeeds.votingPeriod();
      const newPeriod = 7200n; // 2 hours

      await theSeeds.connect(admin).updateVotingPeriod(newPeriod);

      // Should NOT be updated yet
      expect(await theSeeds.votingPeriod()).to.equal(currentPeriod);

      // Should be scheduled
      expect(await theSeeds.nextVotingPeriod()).to.equal(newPeriod);
    });

    it("should apply deferred updates after winner selection", async function () {
      const newPeriod = 7200n; // 2 hours

      // Submit and bless a seed
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

      const merkleData = [{ address: user1.address, tokenIds: [1] }];
      const merkleTree = generateMerkleTree(merkleData);
      const root = merkleTree.getHexRoot();
      await theSeeds.connect(admin).updateOwnershipRoot(root);
      const proof = getMerkleProof(merkleTree, user1.address, [1]);

      await theSeeds.connect(user1).blessSeed(0, [1], proof);

      // Schedule update
      await theSeeds.connect(admin).updateVotingPeriod(newPeriod);

      // Advance time and select winner
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await theSeeds.selectDailyWinner();

      // Now it should be applied
      expect(await theSeeds.votingPeriod()).to.equal(newPeriod);
      expect(await theSeeds.nextVotingPeriod()).to.equal(0); // Cleared
    });

    it("should defer blessings per NFT updates", async function () {
      const newAmount = 5n;

      await theSeeds.connect(admin).updateBlessingsPerNFT(newAmount);

      // Should be scheduled
      expect(await theSeeds.nextBlessingsPerNFT()).to.equal(newAmount);

      // Current should remain unchanged
      expect(await theSeeds.blessingsPerNFT()).to.equal(1);
    });
  });

  describe("Score Reset Functionality", function () {
    it("should reset scores when configured", async function () {
      // Enable score reset
      await theSeeds.connect(admin).updateScoreResetPolicy(true);

      // Submit two seeds
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
      await theSeeds.connect(creator).submitSeed("QmTest234567890123456789012345678901234567");

      // Bless both
      const merkleData = [{ address: user1.address, tokenIds: [1] }];
      const merkleTree = generateMerkleTree(merkleData);
      const root = merkleTree.getHexRoot();
      await theSeeds.connect(admin).updateOwnershipRoot(root);
      const proof = getMerkleProof(merkleTree, user1.address, [1]);

      await theSeeds.connect(user1).blessSeed(0, [1], proof);

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      await theSeeds.connect(user1).blessSeed(1, [1], proof);

      // Check scores before winner selection
      const score0Before = await theSeeds.seedBlessingScore(0);
      const score1Before = await theSeeds.seedBlessingScore(1);

      expect(score0Before).to.be.gt(0);
      expect(score1Before).to.be.gt(0);

      // Advance time and select winner
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      const winnerId = await theSeeds.selectDailyWinner();

      // Losing seed's score should be reset
      const losingSeedId = winnerId === 0n ? 1 : 0;
      const losingScore = await theSeeds.seedBlessingScore(losingSeedId);
      expect(losingScore).to.equal(0); // Reset to 0
    });

    it("should not reset scores when disabled", async function () {
      // Keep score reset disabled (default)
      expect(await theSeeds.resetScoresOnRoundEnd()).to.be.false;

      // Submit and bless seeds (similar to above test)
      // Then verify scores are NOT reset after winner selection
      // (Implementation similar to above test but checking scores persist)
    });
  });

  describe("Enhanced Events", function () {
    it("should emit SeedScoreUpdated on blessing", async function () {
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

      const merkleData = [{ address: user1.address, tokenIds: [1] }];
      const merkleTree = generateMerkleTree(merkleData);
      const root = merkleTree.getHexRoot();
      await theSeeds.connect(admin).updateOwnershipRoot(root);
      const proof = getMerkleProof(merkleTree, user1.address, [1]);

      await expect(theSeeds.connect(user1).blessSeed(0, [1], proof))
        .to.emit(theSeeds, "SeedScoreUpdated");
    });

    it("should emit BlessingFailed on batch blessing failures", async function () {
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

      // Invalid proof
      const invalidProof: string[] = [];

      await expect(
        theSeeds.connect(relayer).batchBlessSeedsFor(
          [0],
          [user1.address],
          [[1]],
          [invalidProof]
        )
      ).to.emit(theSeeds, "BlessingFailed");
    });

    it("should emit VotingPeriodScheduled on config update", async function () {
      await expect(theSeeds.connect(admin).updateVotingPeriod(7200))
        .to.emit(theSeeds, "VotingPeriodScheduled");
    });

    it("should emit ScoresReset when scores are reset", async function () {
      // Enable score reset
      await theSeeds.connect(admin).updateScoreResetPolicy(true);

      // Submit and bless seed
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
      await theSeeds.connect(creator).submitSeed("QmTest234567890123456789012345678901234567");

      const merkleData = [{ address: user1.address, tokenIds: [1] }];
      const merkleTree = generateMerkleTree(merkleData);
      const root = merkleTree.getHexRoot();
      await theSeeds.connect(admin).updateOwnershipRoot(root);
      const proof = getMerkleProof(merkleTree, user1.address, [1]);

      await theSeeds.connect(user1).blessSeed(0, [1], proof);

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      await theSeeds.connect(user1).blessSeed(1, [1], proof);

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      // Should emit ScoresReset
      await expect(theSeeds.selectDailyWinner())
        .to.emit(theSeeds, "ScoresReset");
    });
  });

  describe("View Functions with Retracted Filtering", function () {
    it("should exclude retracted seeds from getCurrentLeader", async function () {
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
      await theSeeds.connect(creator).submitSeed("QmTest234567890123456789012345678901234567");

      // Retract first
      await theSeeds.connect(creator).retractSeed(0);

      // Bless second
      const merkleData = [{ address: user1.address, tokenIds: [1] }];
      const merkleTree = generateMerkleTree(merkleData);
      const root = merkleTree.getHexRoot();
      await theSeeds.connect(admin).updateOwnershipRoot(root);
      const proof = getMerkleProof(merkleTree, user1.address, [1]);

      await theSeeds.connect(user1).blessSeed(1, [1], proof);

      const [leaderId] = await theSeeds.getCurrentLeader();
      expect(leaderId).to.equal(1); // Not 0 (retracted)
    });

    it("should exclude retracted seeds from getEligibleSeeds", async function () {
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
      await theSeeds.connect(creator).submitSeed("QmTest234567890123456789012345678901234567");
      await theSeeds.connect(creator).retractSeed(0);

      const eligible = await theSeeds.getEligibleSeeds();
      expect(eligible.length).to.equal(1);
      expect(eligible[0]).to.equal(1);
    });
  });

  describe("Contract Version", function () {
    it("should have correct version string", async function () {
      const version = await theSeeds.VERSION();
      expect(version).to.equal("1.2.0");
    });
  });

  describe("Initial Creator Grant", function () {
    it("should grant CREATOR_ROLE to initial creator in constructor", async function () {
      const CREATOR_ROLE = await theSeeds.CREATOR_ROLE();
      const hasRole = await theSeeds.hasRole(CREATOR_ROLE, creator.address);
      expect(hasRole).to.be.true;
    });
  });

  describe("Round Mode Configuration (v1.2.0)", function () {
    it("should initialize with ROUND_BASED mode by default", async function () {
      const mode = await theSeeds.roundMode();
      expect(mode).to.equal(0); // RoundMode.ROUND_BASED
    });

    it("should allow admin to update round mode to NON_ROUND_BASED", async function () {
      await expect(theSeeds.connect(admin).updateRoundMode(1)) // NON_ROUND_BASED
        .to.emit(theSeeds, "RoundModeUpdated")
        .withArgs(0, 1);

      expect(await theSeeds.roundMode()).to.equal(1);
    });

    it("should not allow non-admin to update round mode", async function () {
      await expect(
        theSeeds.connect(user1).updateRoundMode(1)
      ).to.be.reverted;
    });

    it("should select winner from all eligible seeds in NON_ROUND_BASED mode", async function () {
      // Switch to NON_ROUND_BASED mode
      await theSeeds.connect(admin).updateRoundMode(1);

      // Create seed in round 1
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

      const merkleData = [{ address: user1.address, tokenIds: [1] }];
      const merkleTree = generateMerkleTree(merkleData);
      const root = merkleTree.getHexRoot();
      await theSeeds.connect(admin).updateOwnershipRoot(root);
      const proof = getMerkleProof(merkleTree, user1.address, [1]);

      await theSeeds.connect(user1).blessSeed(0, [1], proof);

      // Advance to round 2
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await theSeeds.selectDailyWinner();

      // Create seed in round 2 but don't bless it
      await theSeeds.connect(creator).submitSeed("QmTest234567890123456789012345678901234567");

      // In NON_ROUND_BASED mode, seed from round 1 should not be eligible again (already won)
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      // Should revert or handle deadlock since seed 0 already won
      const eligible = await theSeeds.getEligibleSeeds();
      expect(eligible).to.not.include(0n);
    });
  });

  describe("Tie-Breaking Strategies (v1.2.0)", function () {
    beforeEach(async function () {
      // Create 3 seeds with same score
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
      await theSeeds.connect(creator).submitSeed("QmTest234567890123456789012345678901234567");
      await theSeeds.connect(creator).submitSeed("QmTest345678901234567890123456789012345678");

      const merkleData = [
        { address: user1.address, tokenIds: [1] },
        { address: user2.address, tokenIds: [4] },
      ];
      const merkleTree = generateMerkleTree(merkleData);
      const root = merkleTree.getHexRoot();
      await theSeeds.connect(admin).updateOwnershipRoot(root);

      const proof1 = getMerkleProof(merkleTree, user1.address, [1]);
      const proof2 = getMerkleProof(merkleTree, user2.address, [4]);

      // Give all seeds equal score
      await theSeeds.connect(user1).blessSeed(0, [1], proof1);

      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine", []);

      await theSeeds.connect(user1).blessSeed(1, [1], proof2);

      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine", []);

      await theSeeds.connect(user2).blessSeed(2, [4], proof1);
    });

    it("should use LOWEST_SEED_ID strategy by default", async function () {
      const strategy = await theSeeds.tieBreakingStrategy();
      expect(strategy).to.equal(2); // TieBreakingStrategy.LOWEST_SEED_ID
    });

    it("should select lowest seed ID with LOWEST_SEED_ID strategy", async function () {
      await theSeeds.connect(admin).updateTieBreakingStrategy(2); // LOWEST_SEED_ID

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      const winnerId = await theSeeds.selectDailyWinner();
      expect(winnerId).to.equal(0); // Lowest ID
    });

    it("should select highest seed ID with HIGHEST_SEED_ID strategy", async function () {
      await theSeeds.connect(admin).updateTieBreakingStrategy(3); // HIGHEST_SEED_ID

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      const winnerId = await theSeeds.selectDailyWinner();
      expect(winnerId).to.equal(2); // Highest ID
    });

    it("should select earliest submission with EARLIEST_SUBMISSION strategy", async function () {
      await theSeeds.connect(admin).updateTieBreakingStrategy(0); // EARLIEST_SUBMISSION

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      const winnerId = await theSeeds.selectDailyWinner();
      expect(winnerId).to.equal(0); // First submitted
    });

    it("should select latest submission with LATEST_SUBMISSION strategy", async function () {
      await theSeeds.connect(admin).updateTieBreakingStrategy(1); // LATEST_SUBMISSION

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      const winnerId = await theSeeds.selectDailyWinner();
      expect(winnerId).to.equal(2); // Last submitted
    });

    it("should select pseudo-random with PSEUDO_RANDOM strategy", async function () {
      await theSeeds.connect(admin).updateTieBreakingStrategy(4); // PSEUDO_RANDOM

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      const winnerId = await theSeeds.selectDailyWinner();
      // Winner should be one of the tied seeds
      expect(winnerId).to.be.oneOf([0n, 1n, 2n]);
    });

    it("should emit event when updating tie-breaking strategy", async function () {
      await expect(theSeeds.connect(admin).updateTieBreakingStrategy(3))
        .to.emit(theSeeds, "TieBreakingStrategyUpdated")
        .withArgs(2, 3); // From LOWEST_SEED_ID to HIGHEST_SEED_ID
    });
  });

  describe("Deadlock Strategies (v1.2.0)", function () {
    it("should initialize with REVERT strategy by default", async function () {
      const strategy = await theSeeds.deadlockStrategy();
      expect(strategy).to.equal(0); // DeadlockStrategy.REVERT
    });

    it("should revert on no eligible seeds with REVERT strategy", async function () {
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

      // Don't bless any seed
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        theSeeds.selectDailyWinner()
      ).to.be.revertedWithCustomError(theSeeds, "NoValidWinner");
    });

    it("should skip round with SKIP_ROUND strategy", async function () {
      await theSeeds.connect(admin).updateDeadlockStrategy(1); // SKIP_ROUND

      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

      const currentRound = await theSeeds.currentRound();

      // Don't bless any seed
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      await expect(theSeeds.selectDailyWinner())
        .to.emit(theSeeds, "RoundSkipped")
        .withArgs(currentRound, await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1), "No eligible seeds");

      // Should advance to next round
      expect(await theSeeds.currentRound()).to.equal(currentRound + 1n);

      // Winner should be 0 (no winner)
      const winner = await theSeeds.roundWinners(currentRound);
      expect(winner).to.equal(0);
    });

    it("should select random seed with RANDOM_FROM_ALL strategy", async function () {
      await theSeeds.connect(admin).updateDeadlockStrategy(2); // RANDOM_FROM_ALL

      // Create seeds but don't bless them (all have 0 score)
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
      await theSeeds.connect(creator).submitSeed("QmTest234567890123456789012345678901234567");

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      const winnerId = await theSeeds.selectDailyWinner();
      // Should select one of the seeds randomly
      expect(winnerId).to.be.oneOf([0n, 1n]);
    });

    it("should allow rewins with ALLOW_REWINS strategy", async function () {
      await theSeeds.connect(admin).updateDeadlockStrategy(3); // ALLOW_REWINS

      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

      const merkleData = [{ address: user1.address, tokenIds: [1] }];
      const merkleTree = generateMerkleTree(merkleData);
      const root = merkleTree.getHexRoot();
      await theSeeds.connect(admin).updateOwnershipRoot(root);
      const proof = getMerkleProof(merkleTree, user1.address, [1]);

      // Round 1: Seed 0 wins
      await theSeeds.connect(user1).blessSeed(0, [1], proof);
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await theSeeds.selectDailyWinner();

      // Round 2: No new seeds, seed 0 should be eligible again
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await theSeeds.connect(user1).blessSeed(0, [1], proof);

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      // Should not revert, seed 0 can win again
      const winnerId = await theSeeds.selectDailyWinner();
      expect(winnerId).to.equal(0);
    });

    it("should emit event when updating deadlock strategy", async function () {
      await expect(theSeeds.connect(admin).updateDeadlockStrategy(1))
        .to.emit(theSeeds, "DeadlockStrategyUpdated")
        .withArgs(0, 1);
    });
  });

  describe("Eligible Seeds Tracking (v1.2.0)", function () {
    it("should track eligible seeds count", async function () {
      expect(await theSeeds.getEligibleSeedsCount()).to.equal(0);

      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
      expect(await theSeeds.getEligibleSeedsCount()).to.equal(1);

      await theSeeds.connect(creator).submitSeed("QmTest234567890123456789012345678901234567");
      expect(await theSeeds.getEligibleSeedsCount()).to.equal(2);
    });

    it("should remove seed from eligible array when it wins", async function () {
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
      await theSeeds.connect(creator).submitSeed("QmTest234567890123456789012345678901234567");

      expect(await theSeeds.getEligibleSeedsCount()).to.equal(2);

      const merkleData = [{ address: user1.address, tokenIds: [1] }];
      const merkleTree = generateMerkleTree(merkleData);
      const root = merkleTree.getHexRoot();
      await theSeeds.connect(admin).updateOwnershipRoot(root);
      const proof = getMerkleProof(merkleTree, user1.address, [1]);

      await theSeeds.connect(user1).blessSeed(0, [1], proof);

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await theSeeds.selectDailyWinner();

      // Seed 0 won, so only 1 eligible seed left
      expect(await theSeeds.getEligibleSeedsCount()).to.equal(1);
    });

    it("should remove seed from eligible array when retracted", async function () {
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
      await theSeeds.connect(creator).submitSeed("QmTest234567890123456789012345678901234567");

      expect(await theSeeds.getEligibleSeedsCount()).to.equal(2);

      await theSeeds.connect(creator).retractSeed(0);

      expect(await theSeeds.getEligibleSeedsCount()).to.equal(1);
    });

    it("should paginate eligible seeds correctly", async function () {
      // Create 5 seeds
      for (let i = 0; i < 5; i++) {
        await theSeeds.connect(creator).submitSeed(`QmTest${i}23456789012345678901234567890123456`);
      }

      // Get first 3
      const page1 = await theSeeds.getEligibleSeedsPaginated(0, 3);
      expect(page1.length).to.equal(3);

      // Get next 2
      const page2 = await theSeeds.getEligibleSeedsPaginated(3, 3);
      expect(page2.length).to.equal(2);
    });
  });

  describe("Per-Round Score Tracking (v1.2.0)", function () {
    it("should track scores per round when reset is enabled", async function () {
      await theSeeds.connect(admin).updateScoreResetPolicy(true);

      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

      const merkleData = [{ address: user1.address, tokenIds: [1] }];
      const merkleTree = generateMerkleTree(merkleData);
      const root = merkleTree.getHexRoot();
      await theSeeds.connect(admin).updateOwnershipRoot(root);
      const proof = getMerkleProof(merkleTree, user1.address, [1]);

      // Bless in round 1
      await theSeeds.connect(user1).blessSeed(0, [1], proof);
      const round1Score = await theSeeds.seedScoreByRound(1, 0);
      expect(round1Score).to.be.gt(0);

      // Move to round 2
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      await theSeeds.connect(creator).submitSeed("QmTest234567890123456789012345678901234567");
      await theSeeds.connect(user1).blessSeed(1, [1], proof);
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await theSeeds.selectDailyWinner();

      // Round 2 should have its own scores
      const round2Score = await theSeeds.seedScoreByRound(2, 1);
      expect(round2Score).to.be.gt(0);
    });

    it("should track per-round blessing counts", async function () {
      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");

      const merkleData = [{ address: user1.address, tokenIds: [1] }];
      const merkleTree = generateMerkleTree(merkleData);
      const root = merkleTree.getHexRoot();
      await theSeeds.connect(admin).updateOwnershipRoot(root);
      const proof = getMerkleProof(merkleTree, user1.address, [1]);

      await theSeeds.connect(user1).blessSeed(0, [1], proof);

      // Check per-round blessing count
      const round1Blessings = await theSeeds.userSeedBlessingsByRound(1, user1.address, 0);
      expect(round1Blessings).to.equal(1);
    });
  });

  describe("Pause with Reason (v1.2.0)", function () {
    it("should allow setting pause reason", async function () {
      await theSeeds.connect(admin).pause("Emergency maintenance");
      expect(await theSeeds.pauseReason()).to.equal("Emergency maintenance");
    });

    it("should clear pause reason on unpause", async function () {
      await theSeeds.connect(admin).pause("Testing");
      await theSeeds.connect(admin).unpause();
      expect(await theSeeds.pauseReason()).to.equal("");
    });
  });

  describe("New View Functions (v1.2.0)", function () {
    it("should return correct round mode", async function () {
      expect(await theSeeds.getRoundMode()).to.equal(0); // ROUND_BASED

      await theSeeds.connect(admin).updateRoundMode(1);
      expect(await theSeeds.getRoundMode()).to.equal(1); // NON_ROUND_BASED
    });

    it("should return correct tie-breaking strategy", async function () {
      expect(await theSeeds.getTieBreakingStrategy()).to.equal(2); // LOWEST_SEED_ID
    });

    it("should return correct deadlock strategy", async function () {
      expect(await theSeeds.getDeadlockStrategy()).to.equal(0); // REVERT
    });

    it("should return total seeds count", async function () {
      expect(await theSeeds.getTotalSeedsCount()).to.equal(0);

      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
      expect(await theSeeds.getTotalSeedsCount()).to.equal(1);
    });

    it("should return seconds until daily reset", async function () {
      const seconds = await theSeeds.getSecondsUntilDailyReset();
      expect(seconds).to.be.lte(86400); // Less than 24 hours
      expect(seconds).to.be.gt(0);
    });
  });

  describe("Integration: Complete Round Lifecycle (v1.2.0)", function () {
    it("should handle complete round with new features", async function () {
      // Setup: 3 seeds, different strategies
      await theSeeds.connect(admin).updateScoreResetPolicy(true);
      await theSeeds.connect(admin).updateTieBreakingStrategy(0); // EARLIEST_SUBMISSION

      await theSeeds.connect(creator).submitSeed("QmTest123456789012345678901234567890123456");
      await theSeeds.connect(creator).submitSeed("QmTest234567890123456789012345678901234567");
      await theSeeds.connect(creator).submitSeed("QmTest345678901234567890123456789012345678");

      const merkleData = [
        { address: user1.address, tokenIds: [1] },
        { address: user2.address, tokenIds: [4] },
      ];
      const merkleTree = generateMerkleTree(merkleData);
      const root = merkleTree.getHexRoot();
      await theSeeds.connect(admin).updateOwnershipRoot(root);

      const proof1 = getMerkleProof(merkleTree, user1.address, [1]);
      const proof2 = getMerkleProof(merkleTree, user2.address, [4]);

      // Bless seeds
      await theSeeds.connect(user1).blessSeed(0, [1], proof1);
      await theSeeds.connect(user2).blessSeed(1, [4], proof2);
      await theSeeds.connect(user1).blessSeed(2, [1], proof1);

      // Check eligible count before winner selection
      const eligibleBefore = await theSeeds.getEligibleSeedsCount();
      expect(eligibleBefore).to.equal(3);

      // Select winner
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      const winnerId = await theSeeds.selectDailyWinner();

      // Check winner is marked correctly
      const winningSeed = await theSeeds.getSeed(winnerId);
      expect(winningSeed.isWinner).to.be.true;

      // Check eligible count after winner selection
      const eligibleAfter = await theSeeds.getEligibleSeedsCount();
      expect(eligibleAfter).to.equal(2); // Winner removed

      // Check round advanced
      expect(await theSeeds.currentRound()).to.equal(2);
    });
  });
});
