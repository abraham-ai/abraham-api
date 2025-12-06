import { expect } from "chai";
import { ethers } from "hardhat";
import { TheSeeds } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

describe("TheSeeds", function () {
  let seeds: TheSeeds;
  let admin: SignerWithAddress;
  let relayer: SignerWithAddress;
  let creator: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  let merkleRoot: string;
  let merkleTree: any;
  let user1Proof: string[];
  let user2Proof: string[];
  let user3Proof: string[];

  // Helper to generate merkle tree for NFT ownership
  function generateMerkleTree(userData: [string, number[]][]) {
    const tree = StandardMerkleTree.of(userData, ["address", "uint256[]"]);
    return tree;
  }

  beforeEach(async function () {
    [admin, relayer, creator, user1, user2, user3] = await ethers.getSigners();

    const TheSeedsFactory = await ethers.getContractFactory("TheSeeds");
    seeds = await TheSeedsFactory.deploy(admin.address);
    await seeds.waitForDeployment();

    // Grant relayer role
    const RELAYER_ROLE = await seeds.RELAYER_ROLE();
    await seeds.connect(admin).grantRole(RELAYER_ROLE, relayer.address);

    // Grant creator role
    const CREATOR_ROLE = await seeds.CREATOR_ROLE();
    await seeds.connect(admin).grantRole(CREATOR_ROLE, creator.address);

    // Generate Merkle tree for NFT ownership
    // user1 owns tokens [1, 2, 3] (3 NFTs)
    // user2 owns tokens [4, 5] (2 NFTs)
    // user3 owns token [6] (1 NFT)
    const userData: [string, number[]][] = [
      [user1.address, [1, 2, 3]],
      [user2.address, [4, 5]],
      [user3.address, [6]],
    ];

    merkleTree = generateMerkleTree(userData);
    merkleRoot = merkleTree.root;

    // Get proofs for each user
    user1Proof = merkleTree.getProof([user1.address, [1, 2, 3]]);
    user2Proof = merkleTree.getProof([user2.address, [4, 5]]);
    user3Proof = merkleTree.getProof([user3.address, [6]]);

    // Set the Merkle root
    await seeds.connect(admin).updateOwnershipRoot(merkleRoot);
  });

  describe("Deployment", function () {
    it("Should set the correct admin", async function () {
      const ADMIN_ROLE = await seeds.ADMIN_ROLE();
      expect(await seeds.hasRole(ADMIN_ROLE, admin.address)).to.equal(true);
    });

    it("Should initialize with round 1", async function () {
      expect(await seeds.currentRound()).to.equal(1);
    });

    it("Should not be paused initially", async function () {
      expect(await seeds.paused()).to.equal(false);
    });

    it("Should set the Merkle root", async function () {
      expect(await seeds.currentOwnershipRoot()).to.equal(merkleRoot);
    });

    it("Should grant relayer role", async function () {
      const RELAYER_ROLE = await seeds.RELAYER_ROLE();
      expect(await seeds.hasRole(RELAYER_ROLE, relayer.address)).to.equal(true);
    });

    it("Should grant creator role", async function () {
      const CREATOR_ROLE = await seeds.CREATOR_ROLE();
      expect(await seeds.hasRole(CREATOR_ROLE, creator.address)).to.equal(true);
    });
  });

  describe("Seed Submission", function () {
    it("Should allow creator to submit a seed", async function () {
      const tx = await seeds.connect(creator).submitSeed("QmTestHash123");

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(seeds, "SeedSubmitted")
        .withArgs(0, creator.address, "QmTestHash123", "", block!.timestamp);

      const seed = await seeds.getSeed(0);
      expect(seed.creator).to.equal(creator.address);
      expect(seed.ipfsHash).to.equal("QmTestHash123");
      expect(seed.blessings).to.equal(0);
      expect(seed.isWinner).to.equal(false);
    });

    it("Should increment seed count", async function () {
      await seeds.connect(creator).submitSeed("QmHash1");
      expect(await seeds.seedCount()).to.equal(1);

      await seeds.connect(creator).submitSeed("QmHash2");
      expect(await seeds.seedCount()).to.equal(2);
    });

    it("Should revert if IPFS hash is empty", async function () {
      await expect(
        seeds.connect(creator).submitSeed("")
      ).to.be.revertedWithCustomError(seeds, "InvalidSeedData");
    });

    it("Should allow multiple creators to submit seeds", async function () {
      // Grant creator role to user1
      const CREATOR_ROLE = await seeds.CREATOR_ROLE();
      await seeds.connect(admin).grantRole(CREATOR_ROLE, user1.address);

      await seeds.connect(creator).submitSeed("QmHash1");
      await seeds.connect(user1).submitSeed("QmHash2");

      const seed1 = await seeds.getSeed(0);
      const seed2 = await seeds.getSeed(1);

      expect(seed1.creator).to.equal(creator.address);
      expect(seed2.creator).to.equal(user1.address);
    });

    it("Should not allow non-creator to submit seed", async function () {
      await expect(
        seeds.connect(user1).submitSeed("QmHash")
      ).to.be.reverted;
    });
  });

  describe("Seed Retraction", function () {
    beforeEach(async function () {
      await seeds.connect(creator).submitSeed("QmHash");
    });

    it("Should allow creator to retract a seed", async function () {
      await expect(seeds.connect(creator).retractSeed(0))
        .to.emit(seeds, "SeedRetracted")
        .withArgs(0, creator.address);

      const seed = await seeds.getSeed(0);
      expect(seed.isWinner).to.equal(true); // Uses isWinner flag for retraction
    });

    it("Should not allow non-creator to retract", async function () {
      await expect(
        seeds.connect(user1).retractSeed(0)
      ).to.be.revertedWithCustomError(seeds, "NotSeedCreator");
    });

    it("Should not allow retracting nonexistent seed", async function () {
      await expect(
        seeds.connect(creator).retractSeed(999)
      ).to.be.revertedWithCustomError(seeds, "SeedNotFound");
    });

    it("Should not allow retracting a winning seed", async function () {
      // Create multiple seeds and bless one
      await seeds.connect(creator).submitSeed("QmHash2");

      // User1 approves relayer as delegate
      await seeds.connect(user1).approveDelegate(relayer.address, true);

      // Bless seed 0
      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      // Fast forward past blessing period
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      // Select winner
      await seeds.selectDailyWinner();

      // Try to retract the winning seed
      await expect(
        seeds.connect(creator).retractSeed(0)
      ).to.be.revertedWithCustomError(seeds, "CannotRetractWinningSeed");
    });
  });

  describe("Blessing Delegation", function () {
    it("Should allow user to approve delegate", async function () {
      await expect(
        seeds.connect(user1).approveDelegate(relayer.address, true)
      )
        .to.emit(seeds, "DelegateApproval")
        .withArgs(user1.address, relayer.address, true);

      expect(await seeds.isDelegate(user1.address, relayer.address)).to.equal(
        true
      );
    });

    it("Should allow user to revoke delegate", async function () {
      await seeds.connect(user1).approveDelegate(relayer.address, true);

      await expect(
        seeds.connect(user1).approveDelegate(relayer.address, false)
      )
        .to.emit(seeds, "DelegateApproval")
        .withArgs(user1.address, relayer.address, false);

      expect(await seeds.isDelegate(user1.address, relayer.address)).to.equal(
        false
      );
    });
  });

  describe("Blessing Submission", function () {
    beforeEach(async function () {
      await seeds.connect(creator).submitSeed("QmHash1");
      await seeds.connect(creator).submitSeed("QmHash2");
    });

    it("Should allow relayer to submit blessing for user", async function () {
      // User1 approves relayer
      await seeds.connect(user1).approveDelegate(relayer.address, true);

      await expect(
        seeds.connect(relayer).blessSeedFor(
          0,
          user1.address,
          [1, 2, 3],
          user1Proof
        )
      )
        .to.emit(seeds, "BlessingSubmitted")
        .withArgs(0, user1.address, relayer.address, true, await ethers.provider.getBlock("latest").then(b => b!.timestamp + 1));

      const seed = await seeds.getSeed(0);
      expect(seed.blessings).to.equal(1);
    });

    it("Should not allow blessing without delegation approval", async function () {
      await expect(
        seeds.connect(relayer).blessSeedFor(
          0,
          user1.address,
          [1, 2, 3],
          user1Proof
        )
      ).to.be.revertedWithCustomError(seeds, "NotAuthorized");
    });

    it("Should not allow blessing with invalid merkle proof", async function () {
      await seeds.connect(user1).approveDelegate(relayer.address, true);

      // Use wrong proof
      await expect(
        seeds.connect(relayer).blessSeedFor(
          0,
          user1.address,
          [1, 2, 3],
          user2Proof // Wrong proof
        )
      ).to.be.revertedWithCustomError(seeds, "InvalidMerkleProof");
    });

    it("Should allow multiple blessings from same user on same seed", async function () {
      await seeds.connect(user1).approveDelegate(relayer.address, true);

      // First blessing
      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      // Second blessing (next day)
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      // Update root to simulate new day
      await seeds.connect(admin).updateOwnershipRoot(merkleRoot);

      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      const seed = await seeds.getSeed(0);
      expect(seed.blessings).to.equal(2);

      const userBlessingCount = await seeds.getBlessingCount(user1.address, 0);
      expect(userBlessingCount).to.equal(2);
    });

    it("Should enforce daily blessing limit per NFT", async function () {
      await seeds.connect(user1).approveDelegate(relayer.address, true);

      // First blessing (3 NFTs = 3 blessings allowed per day)
      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      // Try to bless again same day - should fail
      await expect(
        seeds.connect(relayer).blessSeedFor(
          0,
          user1.address,
          [1, 2, 3],
          user1Proof
        )
      ).to.be.revertedWithCustomError(seeds, "DailyBlessingLimitReached");
    });

    it("Should not allow blessing a winning seed", async function () {
      await seeds.connect(user1).approveDelegate(relayer.address, true);

      // Bless seed 0
      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      // Fast forward and select winner
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await seeds.selectDailyWinner();

      // Try to bless the winning seed
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await seeds.connect(admin).updateOwnershipRoot(merkleRoot);

      await expect(
        seeds.connect(relayer).blessSeedFor(
          0,
          user1.address,
          [1, 2, 3],
          user1Proof
        )
      ).to.be.revertedWithCustomError(seeds, "SeedAlreadyWinner");
    });

    it("Should not allow blessing after 24-hour period ends", async function () {
      await seeds.connect(user1).approveDelegate(relayer.address, true);

      // Fast forward past blessing period
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      // Try to bless after period ended
      await expect(
        seeds.connect(relayer).blessSeedFor(
          0,
          user1.address,
          [1, 2, 3],
          user1Proof
        )
      ).to.be.revertedWithCustomError(seeds, "BlessingPeriodEnded");
    });
  });

  describe("Winner Selection with Sqrt Scoring", function () {
    beforeEach(async function () {
      // Create 3 seeds
      await seeds.connect(creator).submitSeed("QmHash1");
      await seeds.connect(creator).submitSeed("QmHash2");
      await seeds.connect(creator).submitSeed("QmHash3");

      // Approve relayer for all users
      await seeds.connect(user1).approveDelegate(relayer.address, true);
      await seeds.connect(user2).approveDelegate(relayer.address, true);
      await seeds.connect(user3).approveDelegate(relayer.address, true);
    });

    it("Should not allow selection before period ends", async function () {
      await expect(
        seeds.selectDailyWinner()
      ).to.be.revertedWithCustomError(seeds, "VotingPeriodNotEnded");
    });

    it("Should revert if no valid winner (no blessings)", async function () {
      // Fast forward past blessing period
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        seeds.selectDailyWinner()
      ).to.be.revertedWithCustomError(seeds, "NoValidWinner");
    });

    it("Should select winner based on sqrt scoring", async function () {
      // Seed 0: user1 blesses once (sqrt(1) = 1)
      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      // Seed 1: user2 blesses once (sqrt(1) = 1)
      await seeds.connect(relayer).blessSeedFor(
        1,
        user2.address,
        [4, 5],
        user2Proof
      );

      // Seed 2: user3 blesses once (sqrt(1) = 1)
      await seeds.connect(relayer).blessSeedFor(
        2,
        user3.address,
        [6],
        user3Proof
      );

      // All have same sqrt score (1), but seed 0 was created first
      // so it should win with time decay factored in

      // Fast forward past blessing period
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      const tx = await seeds.selectDailyWinner();
      const receipt = await tx.wait();

      // Check that seed 0 won (created earliest, same sqrt score)
      const seed0 = await seeds.getSeed(0);
      expect(seed0.isWinner).to.equal(true);
      expect(seed0.winnerInRound).to.equal(1);

      // Check event emission
      await expect(tx)
        .to.emit(seeds, "WinnerSelected");
    });

    it("Should apply sqrt scaling correctly (anti-whale)", async function () {
      // Seed 0: user1 blesses once (sqrt(1) = 1)
      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      // Seed 1: user2 blesses once (sqrt(1) = 1) + user3 blesses once (sqrt(1) = 1)
      // Total score = 1 + 1 = 2
      await seeds.connect(relayer).blessSeedFor(
        1,
        user2.address,
        [4, 5],
        user2Proof
      );
      await seeds.connect(relayer).blessSeedFor(
        1,
        user3.address,
        [6],
        user3Proof
      );

      // Seed 1 should win with score of 2 vs seed 0's score of 1

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      await seeds.selectDailyWinner();

      const seed1 = await seeds.getSeed(1);
      expect(seed1.isWinner).to.equal(true);
    });

    it("Should start new blessing period after winner selection", async function () {
      // Bless seed 0
      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      const initialRound = await seeds.currentRound();

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      await expect(seeds.selectDailyWinner())
        .to.emit(seeds, "BlessingPeriodStarted");

      const newRound = await seeds.currentRound();
      expect(newRound).to.equal(initialRound + 1n);
    });

    it("Should record round winner correctly", async function () {
      // Bless seed 0
      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      await seeds.selectDailyWinner();

      const winningSeedId = await seeds.roundWinners(1);
      expect(winningSeedId).to.equal(0);
    });
  });

  describe("Time Decay", function () {
    beforeEach(async function () {
      await seeds.connect(creator).submitSeed("QmHash1");
      await seeds.connect(user1).approveDelegate(relayer.address, true);
      await seeds.connect(user2).approveDelegate(relayer.address, true);
    });

    it("Should favor earlier blessings with time decay", async function () {
      // Seed 0: Bless immediately (24 hours remaining = high weight)
      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      // Wait 12 hours, create seed 1
      await ethers.provider.send("evm_increaseTime", [43200]); // 12 hours
      await ethers.provider.send("evm_mine", []);

      await seeds.connect(creator).submitSeed("QmHash2");

      // Bless seed 1 with same sqrt score but less time remaining (12 hours = lower weight)
      await seeds.connect(relayer).blessSeedFor(
        1,
        user2.address,
        [4, 5],
        user2Proof
      );

      // Fast forward remaining 12 hours to complete 24hr period
      await ethers.provider.send("evm_increaseTime", [43200]);
      await ethers.provider.send("evm_mine", []);

      await seeds.selectDailyWinner();

      // Seed 0 should win due to higher blessing time decay (blessed earlier)
      const seed0 = await seeds.getSeed(0);
      expect(seed0.isWinner).to.equal(true);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await seeds.connect(creator).submitSeed("QmHash1");
      await seeds.connect(creator).submitSeed("QmHash2");
      await seeds.connect(user1).approveDelegate(relayer.address, true);
    });

    it("Should return current leader with blessing score", async function () {
      // Bless seed 0
      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      const [leaderId, score] = await seeds.getCurrentLeader();
      expect(leaderId).to.equal(0);
      expect(score).to.be.gt(0); // Should have positive score
    });

    it("Should return time until period end", async function () {
      const timeRemaining = await seeds.getTimeUntilPeriodEnd();
      expect(timeRemaining).to.be.lte(86400); // Less than or equal to 1 day
      expect(timeRemaining).to.be.gt(0);
    });

    it("Should return zero time after period ends", async function () {
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      const timeRemaining = await seeds.getTimeUntilPeriodEnd();
      expect(timeRemaining).to.equal(0);
    });

    it("Should get blessing count for user and seed", async function () {
      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      const count = await seeds.getBlessingCount(user1.address, 0);
      expect(count).to.equal(1);
    });

    it("Should check if user has blessed seed", async function () {
      expect(await seeds.hasBlessed(user1.address, 0)).to.equal(false);

      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      expect(await seeds.hasBlessed(user1.address, 0)).to.equal(true);
    });

    it("Should get multiple seeds", async function () {
      const fetchedSeeds = await seeds.getSeeds(0, 2);
      expect(fetchedSeeds.length).to.equal(2);
      expect(fetchedSeeds[0].ipfsHash).to.equal("QmHash1");
      expect(fetchedSeeds[1].ipfsHash).to.equal("QmHash2");
    });

    it("Should handle pagination correctly", async function () {
      await seeds.connect(creator).submitSeed("QmHash3");

      const page1 = await seeds.getSeeds(0, 2);
      const page2 = await seeds.getSeeds(2, 2);

      expect(page1.length).to.equal(2);
      expect(page2.length).to.equal(1);
      expect(page2[0].ipfsHash).to.equal("QmHash3");
    });

    it("Should get seeds by round", async function () {
      // Seeds 0 and 1 are in round 1
      const round1Seeds = await seeds.getSeedsByRound(1);
      expect(round1Seeds.length).to.equal(2);
      expect(round1Seeds[0].submittedInRound).to.equal(1);
      expect(round1Seeds[1].submittedInRound).to.equal(1);
    });

    it("Should get current round seeds", async function () {
      const currentRoundSeeds = await seeds.getCurrentRoundSeeds();
      expect(currentRoundSeeds.length).to.equal(2); // Both seeds are in current round
    });
  });

  describe("Ownership Root Management", function () {
    it("Should allow admin to update Merkle root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new_root"));

      await expect(seeds.connect(admin).updateOwnershipRoot(newRoot))
        .to.emit(seeds, "OwnershipRootUpdated");

      expect(await seeds.currentOwnershipRoot()).to.equal(newRoot);
    });

    it("Should not allow non-admin to update root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new_root"));

      await expect(
        seeds.connect(user1).updateOwnershipRoot(newRoot)
      ).to.be.reverted;
    });

    it("Should not allow zero root", async function () {
      await expect(
        seeds.connect(admin).updateOwnershipRoot(ethers.ZeroHash)
      ).to.be.revertedWithCustomError(seeds, "InvalidOwnershipRoot");
    });

    it("Should update root timestamp", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new_root"));
      const tx = await seeds.connect(admin).updateOwnershipRoot(newRoot);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      const timestamp = await seeds.rootTimestamp();
      expect(timestamp).to.equal(block!.timestamp);
    });
  });

  describe("Pause Functionality", function () {
    it("Should allow admin to pause", async function () {
      await expect(seeds.connect(admin).pause())
        .to.emit(seeds, "ContractPaused")
        .withArgs(admin.address);

      expect(await seeds.paused()).to.equal(true);
    });

    it("Should allow admin to unpause", async function () {
      await seeds.connect(admin).pause();

      await expect(seeds.connect(admin).unpause())
        .to.emit(seeds, "ContractUnpaused")
        .withArgs(admin.address);

      expect(await seeds.paused()).to.equal(false);
    });

    it("Should prevent seed submission when paused", async function () {
      await seeds.connect(admin).pause();

      await expect(
        seeds.connect(creator).submitSeed("QmHash")
      ).to.be.reverted;
    });

    it("Should prevent winner selection when paused", async function () {
      await seeds.connect(creator).submitSeed("QmHash");
      await seeds.connect(user1).approveDelegate(relayer.address, true);
      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      await seeds.connect(admin).pause();

      await expect(seeds.selectDailyWinner()).to.be.reverted;
    });

    it("Should not allow non-admin to pause", async function () {
      await expect(
        seeds.connect(user1).pause()
      ).to.be.reverted;
    });
  });

  describe("Round-Based Competition", function () {
    beforeEach(async function () {
      await seeds.connect(user1).approveDelegate(relayer.address, true);
      await seeds.connect(user2).approveDelegate(relayer.address, true);
    });

    it("Should only consider seeds from current round in winner selection", async function () {
      // Round 1: Create and bless seed 0
      await seeds.connect(creator).submitSeed("QmRound1Seed");
      await seeds.connect(relayer).blessSeedFor(
        0,
        user1.address,
        [1, 2, 3],
        user1Proof
      );

      // Fast forward to end round 1
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      // Select winner for round 1
      await seeds.selectDailyWinner();

      // Now in round 2
      expect(await seeds.currentRound()).to.equal(2);

      // Create seeds in round 2
      await seeds.connect(creator).submitSeed("QmRound2Seed1");
      await seeds.connect(creator).submitSeed("QmRound2Seed2");

      // Bless seed 2 (from round 2)
      await seeds.connect(relayer).blessSeedFor(
        2,
        user2.address,
        [4, 5],
        user2Proof
      );

      // Fast forward to end round 2
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      // Select winner - should only consider round 2 seeds
      await seeds.selectDailyWinner();

      // Verify seed 2 won (from round 2), not seed 0 (from round 1)
      const seed2 = await seeds.getSeed(2);
      expect(seed2.isWinner).to.equal(true);
      expect(seed2.winnerInRound).to.equal(2);
    });

    it("Should track seed submission rounds correctly", async function () {
      // Create seed in round 1
      await seeds.connect(creator).submitSeed("QmSeed1");
      const seed0 = await seeds.getSeed(0);
      expect(seed0.submittedInRound).to.equal(1);

      // Move to round 2
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await seeds.connect(relayer).blessSeedFor(0, user1.address, [1, 2, 3], user1Proof);
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);
      await seeds.selectDailyWinner();

      // Create seed in round 2
      await seeds.connect(creator).submitSeed("QmSeed2");
      const seed1 = await seeds.getSeed(1);
      expect(seed1.submittedInRound).to.equal(2);
    });

    it("Should return empty array for rounds with no seeds", async function () {
      const round99Seeds = await seeds.getSeedsByRound(99);
      expect(round99Seeds.length).to.equal(0);
    });
  });

  describe("Constants", function () {
    it("Should have correct blessing period (24 hours)", async function () {
      expect(await seeds.VOTING_PERIOD()).to.equal(86400); // 1 day in seconds
    });
  });
});
