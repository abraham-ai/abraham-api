import { expect } from "chai";
import { ethers } from "hardhat";
import { TheSeeds } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("TheSeeds", function () {
  let seeds: TheSeeds;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let merkleRoot: string;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const TheSeedsFactory = await ethers.getContractFactory("TheSeeds");
    seeds = await TheSeedsFactory.deploy(owner.address);
    await seeds.waitForDeployment();

    // Set a dummy Merkle root
    merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test_root"));
    await seeds.updateOwnershipRoot(merkleRoot);
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await seeds.owner()).to.equal(owner.address);
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
  });

  describe("Seed Submission", function () {
    it("Should allow submitting a seed", async function () {
      const tx = await seeds.connect(user1).submitSeed(
        "QmTestHash123",
        "Test Artwork",
        "A beautiful test artwork"
      );

      await expect(tx)
        .to.emit(seeds, "SeedSubmitted")
        .withArgs(
          0,
          user1.address,
          "QmTestHash123",
          "Test Artwork",
          await ethers.provider.getBlock("latest").then(b => b!.timestamp)
        );

      const seed = await seeds.getSeed(0);
      expect(seed.title).to.equal("Test Artwork");
      expect(seed.creator).to.equal(user1.address);
      expect(seed.ipfsHash).to.equal("QmTestHash123");
      expect(seed.votes).to.equal(0);
      expect(seed.minted).to.equal(false);
    });

    it("Should increment seed count", async function () {
      await seeds.connect(user1).submitSeed("QmHash1", "Title1", "Desc1");
      expect(await seeds.seedCount()).to.equal(1);

      await seeds.connect(user2).submitSeed("QmHash2", "Title2", "Desc2");
      expect(await seeds.seedCount()).to.equal(2);
    });

    it("Should revert if IPFS hash is empty", async function () {
      await expect(
        seeds.connect(user1).submitSeed("", "Title", "Description")
      ).to.be.revertedWithCustomError(seeds, "InvalidSeedData");
    });

    it("Should revert if title is empty", async function () {
      await expect(
        seeds.connect(user1).submitSeed("QmHash", "", "Description")
      ).to.be.revertedWithCustomError(seeds, "InvalidSeedData");
    });

    it("Should allow multiple users to submit seeds", async function () {
      await seeds.connect(user1).submitSeed("QmHash1", "Title1", "Desc1");
      await seeds.connect(user2).submitSeed("QmHash2", "Title2", "Desc2");

      const seed1 = await seeds.getSeed(0);
      const seed2 = await seeds.getSeed(1);

      expect(seed1.creator).to.equal(user1.address);
      expect(seed2.creator).to.equal(user2.address);
    });
  });

  describe("Seed Retraction", function () {
    it("Should allow creator to retract a seed", async function () {
      await seeds.connect(user1).submitSeed("QmHash", "Title", "Description");

      await expect(seeds.connect(user1).retractSeed(0))
        .to.emit(seeds, "SeedRetracted")
        .withArgs(0, user1.address);

      const seed = await seeds.getSeed(0);
      expect(seed.minted).to.equal(true); // Uses minted flag for retraction
    });

    it("Should not allow non-creator to retract", async function () {
      await seeds.connect(user1).submitSeed("QmHash", "Title", "Description");

      await expect(
        seeds.connect(user2).retractSeed(0)
      ).to.be.revertedWithCustomError(seeds, "NotSeedCreator");
    });

    it("Should not allow retracting nonexistent seed", async function () {
      await expect(
        seeds.connect(user1).retractSeed(999)
      ).to.be.revertedWithCustomError(seeds, "SeedNotFound");
    });
  });

  describe("Ownership Root Management", function () {
    it("Should allow owner to update Merkle root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new_root"));

      await expect(seeds.updateOwnershipRoot(newRoot))
        .to.emit(seeds, "OwnershipRootUpdated");

      expect(await seeds.currentOwnershipRoot()).to.equal(newRoot);
    });

    it("Should not allow non-owner to update root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new_root"));

      await expect(
        seeds.connect(user1).updateOwnershipRoot(newRoot)
      ).to.be.reverted;
    });

    it("Should not allow zero root", async function () {
      await expect(
        seeds.updateOwnershipRoot(ethers.ZeroHash)
      ).to.be.revertedWithCustomError(seeds, "InvalidOwnershipRoot");
    });

    it("Should update root timestamp", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("new_root"));
      await seeds.updateOwnershipRoot(newRoot);

      const timestamp = await seeds.rootTimestamp();
      const block = await ethers.provider.getBlock("latest");
      expect(timestamp).to.equal(block!.timestamp);
    });
  });

  describe("Pause Functionality", function () {
    it("Should allow owner to pause", async function () {
      await expect(seeds.pause())
        .to.emit(seeds, "ContractPaused")
        .withArgs(owner.address);

      expect(await seeds.paused()).to.equal(true);
    });

    it("Should allow owner to unpause", async function () {
      await seeds.pause();

      await expect(seeds.unpause())
        .to.emit(seeds, "ContractUnpaused")
        .withArgs(owner.address);

      expect(await seeds.paused()).to.equal(false);
    });

    it("Should prevent seed submission when paused", async function () {
      await seeds.pause();

      await expect(
        seeds.connect(user1).submitSeed("QmHash", "Title", "Description")
      ).to.be.revertedWithCustomError(seeds, "ContractPaused");
    });

    it("Should not allow non-owner to pause", async function () {
      await expect(
        seeds.connect(user1).pause()
      ).to.be.reverted;
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await seeds.connect(user1).submitSeed("QmHash1", "Title1", "Desc1");
      await seeds.connect(user2).submitSeed("QmHash2", "Title2", "Desc2");
    });

    it("Should return current leader", async function () {
      const [leaderId, votes] = await seeds.getCurrentLeader();
      expect(leaderId).to.equal(0);
      expect(votes).to.equal(0); // No votes yet
    });

    it("Should return time until period end", async function () {
      const timeRemaining = await seeds.getTimeUntilPeriodEnd();
      expect(timeRemaining).to.be.lte(86400); // Less than or equal to 1 day
    });

    it("Should get voter current vote", async function () {
      const vote = await seeds.getVoterCurrentVote(user1.address);
      expect(vote.votePower).to.equal(0); // No vote yet
    });

    it("Should get multiple seeds", async function () {
      const fetchedSeeds = await seeds.getSeeds(0, 2);
      expect(fetchedSeeds.length).to.equal(2);
      expect(fetchedSeeds[0].title).to.equal("Title1");
      expect(fetchedSeeds[1].title).to.equal("Title2");
    });

    it("Should handle pagination correctly", async function () {
      await seeds.connect(user1).submitSeed("QmHash3", "Title3", "Desc3");

      const page1 = await seeds.getSeeds(0, 2);
      const page2 = await seeds.getSeeds(2, 2);

      expect(page1.length).to.equal(2);
      expect(page2.length).to.equal(1);
      expect(page2[0].title).to.equal("Title3");
    });
  });

  describe("Winner Selection", function () {
    it("Should not allow selection before period ends", async function () {
      await seeds.connect(user1).submitSeed("QmHash", "Title", "Description");

      await expect(
        seeds.selectDailyWinner()
      ).to.be.revertedWithCustomError(seeds, "VotingPeriodNotEnded");
    });

    it("Should revert if no valid winner", async function () {
      // Advance time past voting period
      await ethers.provider.send("evm_increaseTime", [86400]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        seeds.selectDailyWinner()
      ).to.be.revertedWithCustomError(seeds, "NoValidWinner");
    });
  });

  describe("Constants", function () {
    it("Should have correct voting period", async function () {
      expect(await seeds.VOTING_PERIOD()).to.equal(86400); // 1 day in seconds
    });
  });
});
