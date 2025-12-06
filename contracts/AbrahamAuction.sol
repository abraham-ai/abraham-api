// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AbrahamCovenant} from "./AbrahamCovenant.sol";

/**
 * @title AbrahamAuction
 * @author Eden Platform
 * @notice Multi-auction system for Abraham Covenant NFTs with batch auction creation
 * @dev Allows multiple simultaneous auctions with batch creation, withdrawal pattern for safety
 * @dev Outbid bidders can withdraw their funds using the withdrawal pattern
 */
contract AbrahamAuction is Ownable, ReentrancyGuard, Pausable {
    // ============ Events ============

    event AuctionCreated(
        uint256 indexed auctionId,
        uint256 indexed tokenId,
        uint256 startTime,
        uint256 endTime,
        uint256 minBid
    );
    event BidPlaced(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 amount,
        uint256 timestamp,
        uint256 newEndTime
    );
    event BatchAuctionsCreated(
        uint256[] auctionIds,
        uint256[] tokenIds,
        uint256 duration,
        uint256 minBid,
        uint256 count
    );
    event AuctionSettled(
        uint256 indexed auctionId,
        uint256 indexed tokenId,
        address indexed winner,
        uint256 winningBid
    );
    event AuctionCanceled(uint256 indexed auctionId, uint256 indexed tokenId);
    event SettlementSkipped(uint256 indexed auctionId, string reason);
    event FundsWithdrawn(address indexed user, uint256 amount);
    event StuckFundsRecovered(address indexed user, uint256 amount);
    event AccountingCorrected(address indexed user, uint256 oldAmount, uint256 newAmount);
    event ExtensionWindowUpdated(uint256 previousWindow, uint256 newWindow);
    event ExtensionDurationUpdated(uint256 previousDuration, uint256 newDuration);
    event PayoutAddressUpdated(address previousAddress, address newAddress);
    event PayoutWithdrawn(address indexed recipient, uint256 amount);
    event BidHistoryUpdated(
        uint256 indexed auctionId,
        address indexed bidder,
        uint256 amount,
        uint256 timestamp
    );
    event BidRefunded(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event BidRefundFailed(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event OwnerWithdrewFor(address indexed user, address indexed recipient, uint256 amount);

    // ============ Errors ============

    error InvalidNFTContract();
    error InvalidPayoutAddress();
    error InvalidDuration();
    error InvalidTokenId();
    error AuctionNotActive(uint256 auctionId);
    error AuctionNotEnded(uint256 auctionId);
    error AuctionEnded(uint256 auctionId);
    error AuctionAlreadyExists(uint256 tokenId);
    error BidTooLow(uint256 required, uint256 provided);
    error NoFundsToWithdraw();
    error WithdrawalFailed();
    error AuctionAlreadySettled(uint256 auctionId);
    error EmptyBatchCreate();
    error ApprovalMissing();
    error InvalidExtensionParam();
    error CannotCancelWithBids();
    error NoStuckFundsForUser();
    error TooManyAuctions();
    error MaxExtensionsReached();
    error AlreadyHighestBidder();
    error BidTooHigh();
    error UnsafeTransferNotReady(uint256 availableAt);

    // ============ Constants ============

    /// @notice Minimum bid increment percentage (500 = 5%)
    uint256 public constant MIN_BID_INCREMENT_BPS = 500;

    /// @notice Default extension window (5 minutes)
    uint256 public constant DEFAULT_EXTENSION_WINDOW = 5 minutes;

    /// @notice Default extension duration (5 minutes)
    uint256 public constant DEFAULT_EXTENSION_DURATION = 5 minutes;

    /// @notice Maximum auctions per batch operation
    uint256 public constant MAX_BATCH_SIZE = 50;

    /// @notice Maximum extensions per auction
    uint256 public constant MAX_AUCTION_EXTENSIONS = 1000;

    /// @notice Maximum bid amount (type(uint96).max ~= 79 million ETH)
    uint256 public constant MAX_BID = type(uint96).max;

    /// @notice Grace period before unsafe transfer is allowed (24 hours)
    uint256 public constant UNSAFE_TRANSFER_GRACE_PERIOD = 24 hours;

    /// @notice Minimum auction ID (continues from previous contract)
    uint256 public constant MIN_AUCTION_ID = 13;

    // ============ Structs ============

    /**
     * @notice Auction data structure
     * @dev Optimized for storage: Uses 5 slots (160 bytes)
     * @dev highestBid uses uint96 (max: 79 million ETH - sufficient for art auctions)
     * @dev Slot 4 packs address(20) + uint96(12) = 32 bytes (full)
     * @dev Slot 5 packs uint8(1) + bool(1) + bool(1) = 3 bytes
     */
    struct Auction {
        uint256 tokenId; // slot 0 (32 bytes)
        uint256 startTime; // slot 1 (32 bytes)
        uint256 endTime; // slot 2 (32 bytes)
        uint256 minBid; // slot 3 (32 bytes)
        address highestBidder; // slot 4 (20 bytes)
        uint96 highestBid; // slot 4 (12 bytes) - MAX: ~79M ETH
        uint8 extensionCount; // slot 5 (1 byte)
        bool settled; // slot 5 (1 byte)
        bool exists; // slot 5 (1 byte)
    }

    /**
     * @notice Bid history record
     * @dev Stored in append-only array per auction for transparency
     * @dev Packed: bidder(20) + amount(12) + timestamp(4) = 36 bytes
     */
    struct BidRecord {
        address bidder; // Address who placed the bid
        uint96 amount; // Bid amount in wei (matches Auction.highestBid type)
        uint32 timestamp; // When the bid was placed
    }

    // ============ State Variables ============

    /// @notice AbrahamCovenant NFT contract instance
    AbrahamCovenant public immutable nftContract;

    /// @notice Current auction ID counter (starts at 13 to continue from previous contract)
    uint256 private _auctionIdCounter = MIN_AUCTION_ID;

    /// @notice Time window before auction end that triggers extension
    uint256 public extensionWindow;

    /// @notice Duration to extend auction by
    uint256 public extensionDuration;

    /// @notice Address to receive auction proceeds
    address public payoutAddress;

    /// @notice Mapping of auction ID to auction data
    mapping(uint256 => Auction) public auctions;

    /// @notice Mapping of token ID to auction ID (0 if no auction exists)
    mapping(uint256 => uint256) public tokenToAuction;

    /// @notice Mapping of user address to withdrawable balance
    mapping(address => uint256) public pendingWithdrawals;

    /// @notice Total amount held in pending withdrawals
    uint256 public totalPendingWithdrawals;

    /// @notice Total ETH escrowed in active (unsettled) auction bids
    /// @dev Prevents owner from withdrawing funds before NFT delivery
    uint256 public escrowedActiveBids;

    /// @notice Total realized proceeds from settled auctions
    /// @dev Only these funds are withdrawable by owner
    uint256 public realizedProceeds;

    /// @notice Mapping of auction ID to bid history (append-only)
    mapping(uint256 => BidRecord[]) private _bidHistory;

    // ============ Constructor ============

    /**
     * @notice Initializes the AbrahamAuction contract
     * @param _nftContract Address of the AbrahamCovenant contract
     * @param _owner Address that will own this contract
     * @param _payoutAddress Address to receive auction proceeds
     */
    constructor(address _nftContract, address _owner, address _payoutAddress) Ownable(_owner) {
        if (_nftContract == address(0)) revert InvalidNFTContract();
        if (_payoutAddress == address(0)) revert InvalidPayoutAddress();

        nftContract = AbrahamCovenant(_nftContract);
        payoutAddress = _payoutAddress;
        extensionWindow = DEFAULT_EXTENSION_WINDOW;
        extensionDuration = DEFAULT_EXTENSION_DURATION;

        emit PayoutAddressUpdated(address(0), _payoutAddress);
        emit ExtensionWindowUpdated(0, DEFAULT_EXTENSION_WINDOW);
        emit ExtensionDurationUpdated(0, DEFAULT_EXTENSION_DURATION);
    }

    // ============ External Functions - Auction Management ============

    /**
     * @notice Create a new auction for a specific token index
     * @dev Token must exist, be owned by covenant, and covenant must approve this contract
     * @param tokenId Token ID to auction (must be minted and owned by covenant)
     * @param startTime Auction start time (use 0 for immediate start)
     * @param duration Auction duration in seconds
     * @param minBid Minimum bid for the auction (0 = free auction, any amount accepted)
     * @return auctionId The ID of the created auction
     */
    function createAuction(
        uint256 tokenId,
        uint256 startTime,
        uint256 duration,
        uint256 minBid
    ) external onlyOwner whenNotPaused returns (uint256) {
        if (duration == 0) revert InvalidDuration();
        if (tokenId >= nftContract.maxSupply()) revert InvalidTokenId();
        if (tokenToAuction[tokenId] != 0) revert AuctionAlreadyExists(tokenId);

        // Verify NFT is owned by covenant contract
        // Note: ownerOf will revert with ERC721NonexistentToken if token doesn't exist
        address tokenOwner = nftContract.ownerOf(tokenId);
        if (tokenOwner != address(nftContract)) revert InvalidTokenId();

        // Verify this contract is approved to transfer the NFT
        if (!nftContract.isApprovedForAll(address(nftContract), address(this))) {
            revert ApprovalMissing();
        }

        uint256 auctionId = _auctionIdCounter;
        unchecked {
            _auctionIdCounter = auctionId + 1;
        }

        uint256 actualStartTime = startTime > 0 ? startTime : block.timestamp;
        uint256 endTime = actualStartTime + duration;

        // Validate end time is in the future
        if (endTime <= block.timestamp) revert InvalidDuration();

        auctions[auctionId] = Auction({
            tokenId: tokenId,
            startTime: actualStartTime,
            endTime: endTime,
            minBid: minBid,
            highestBidder: address(0),
            highestBid: 0,
            extensionCount: 0,
            settled: false,
            exists: true
        });

        tokenToAuction[tokenId] = auctionId;

        emit AuctionCreated(auctionId, tokenId, actualStartTime, endTime, minBid);

        return auctionId;
    }

    /**
     * @notice Create multiple auctions at once with the same start time, duration and minimum bid
     * @dev More gas efficient than calling createAuction multiple times
     * @param tokenIds Array of token IDs to auction (must be minted and owned by covenant)
     * @param startTime Auction start time (use 0 for immediate start, applied to all auctions)
     * @param duration Auction duration in seconds (applied to all auctions)
     * @param minBid Minimum bid for all auctions (0 = free auctions, any amount accepted)
     * @return auctionIds Array of created auction IDs
     */
    function batchCreateAuctions(
        uint256[] calldata tokenIds,
        uint256 startTime,
        uint256 duration,
        uint256 minBid
    ) external onlyOwner whenNotPaused returns (uint256[] memory) {
        if (tokenIds.length == 0) revert EmptyBatchCreate();
        if (tokenIds.length > MAX_BATCH_SIZE) revert TooManyAuctions();
        if (duration == 0) revert InvalidDuration();

        // Verify approval once (applies to all tokens)
        if (!nftContract.isApprovedForAll(address(nftContract), address(this))) {
            revert ApprovalMissing();
        }

        uint256[] memory auctionIds = new uint256[](tokenIds.length);
        uint256 actualStartTime = startTime > 0 ? startTime : block.timestamp;
        uint256 endTime = actualStartTime + duration;

        // Validate end time is in the future
        if (endTime <= block.timestamp) revert InvalidDuration();

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 tokenId = tokenIds[i];

            // Validate token
            if (tokenId >= nftContract.maxSupply()) revert InvalidTokenId();
            if (tokenToAuction[tokenId] != 0) revert AuctionAlreadyExists(tokenId);

            // Verify NFT is owned by covenant contract
            // Note: ownerOf will revert with ERC721NonexistentToken if token doesn't exist
            address tokenOwner = nftContract.ownerOf(tokenId);
            if (tokenOwner != address(nftContract)) revert InvalidTokenId();

            // Create auction
            uint256 auctionId = _auctionIdCounter;
            unchecked {
                _auctionIdCounter = auctionId + 1;
            }

            auctions[auctionId] = Auction({
                tokenId: tokenId,
                startTime: actualStartTime,
                endTime: endTime,
                minBid: minBid,
                highestBidder: address(0),
                highestBid: 0,
                extensionCount: 0,
                settled: false,
                exists: true
            });

            tokenToAuction[tokenId] = auctionId;
            auctionIds[i] = auctionId;

            emit AuctionCreated(auctionId, tokenId, actualStartTime, endTime, minBid);
        }

        emit BatchAuctionsCreated(auctionIds, tokenIds, duration, minBid, tokenIds.length);

        return auctionIds;
    }

    /**
     * @notice Place a bid on a specific auction
     * @param auctionId Auction ID to bid on
     * @dev Automatically refunds previous highest bidder
     * @dev If automatic refund fails, bidder can call withdraw() manually
     * @dev Uses 25k gas limit for refund to support smart contract wallets
     */
    function bid(uint256 auctionId) external payable nonReentrant whenNotPaused {
        Auction storage auction = auctions[auctionId];
        if (!auction.exists) revert AuctionNotActive(auctionId);
        if (auction.settled) revert AuctionAlreadySettled(auctionId);
        if (block.timestamp < auction.startTime) revert AuctionNotActive(auctionId);
        if (block.timestamp >= auction.endTime) revert AuctionEnded(auctionId);

        uint256 bidAmount = msg.value;

        // Check maximum bid (uint96 limit for gas optimization)
        if (bidAmount > MAX_BID) {
            revert BidTooHigh();
        }

        // Check minimum bid
        if (bidAmount < auction.minBid) {
            revert BidTooLow(auction.minBid, bidAmount);
        }

        // Prevent self-outbidding
        if (auction.highestBidder == msg.sender) {
            revert AlreadyHighestBidder();
        }

        // Check bid increment if there's already a bid
        if (auction.highestBidder != address(0)) {
            uint256 minIncrement = auction.highestBid +
                (auction.highestBid * MIN_BID_INCREMENT_BPS) /
                10000;
            if (bidAmount < minIncrement) {
                revert BidTooLow(minIncrement, bidAmount);
            }
        }

        // CEI Pattern: Store previous bidder info and update state BEFORE external call
        address previousBidder = auction.highestBidder;
        uint256 previousBid = auction.highestBid;

        auction.highestBidder = msg.sender;
        auction.highestBid = uint96(bidAmount);

        // Update escrow accounting
        if (previousBidder == address(0)) {
            // First bid: add entire amount to escrow
            escrowedActiveBids += bidAmount;
        } else {
            // Subsequent bid: add delta (new bid - old bid) to escrow
            // Note: previousBid is already in escrow, only add the difference
            escrowedActiveBids += (bidAmount - previousBid);
        }

        // Refund previous bidder (automatic with fallback to withdrawal pattern)
        if (previousBidder != address(0)) {
            // Try automatic refund first (gas limited to prevent griefing)
            (bool success, ) = previousBidder.call{value: previousBid, gas: 25000}("");

            if (success) {
                emit BidRefunded(auctionId, previousBidder, previousBid);
            } else {
                // Fallback to withdrawal pattern
                pendingWithdrawals[previousBidder] += previousBid;
                totalPendingWithdrawals += previousBid;
                emit BidRefundFailed(auctionId, previousBidder, previousBid);
            }
        }

        // Check if we need to extend auction (bid in last extension window)
        uint256 timeRemaining = auction.endTime - block.timestamp;
        uint256 newEndTime = auction.endTime;

        if (timeRemaining < extensionWindow) {
            // Check extension limit
            if (auction.extensionCount >= MAX_AUCTION_EXTENSIONS) {
                revert MaxExtensionsReached();
            }

            auction.extensionCount++;
            newEndTime = block.timestamp + extensionDuration;
            auction.endTime = newEndTime;
        }

        // Append to bid history (append-only for transparency)
        _bidHistory[auctionId].push(
            BidRecord({
                bidder: msg.sender,
                amount: uint96(bidAmount),
                timestamp: uint32(block.timestamp)
            })
        );

        emit BidPlaced(auctionId, msg.sender, bidAmount, block.timestamp, newEndTime);
        emit BidHistoryUpdated(auctionId, msg.sender, bidAmount, block.timestamp);
    }

    /**
     * @notice Settle an auction and transfer NFT to winner
     * @dev Can be called by anyone after auction ends
     * @dev Automatically sends proceeds to payoutAddress (falls back to manual withdrawal if transfer fails)
     * @dev Re-checks approval to prevent bricking if covenant revoked approval
     * @dev Uses safeTransferFrom to prevent NFTs getting stuck in contracts without ERC721Receiver
     * @param auctionId Auction ID to settle
     */
    function settleAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (!auction.exists) revert AuctionNotActive(auctionId);
        if (block.timestamp < auction.endTime) revert AuctionNotEnded(auctionId);
        if (auction.settled) revert AuctionAlreadySettled(auctionId);

        // If no bids, mark as settled and cancel
        if (auction.highestBidder == address(0)) {
            auction.settled = true;
            tokenToAuction[auction.tokenId] = 0;
            emit AuctionCanceled(auctionId, auction.tokenId);
            return;
        }

        // Re-check approval before attempting transfer (prevents bricking)
        if (!nftContract.isApprovedForAll(address(nftContract), address(this))) {
            revert ApprovalMissing();
        }

        auction.settled = true;
        uint256 tokenId = auction.tokenId;
        uint256 winningBid = auction.highestBid;

        // Move funds from escrow
        escrowedActiveBids -= winningBid;

        // Clear tokenToAuction mapping
        tokenToAuction[tokenId] = 0;

        // Transfer NFT from covenant to winner (safe transfer prevents stuck NFTs)
        nftContract.safeTransferFrom(address(nftContract), auction.highestBidder, tokenId);

        // Attempt to send proceeds directly to payout address
        (bool success, ) = payable(payoutAddress).call{value: winningBid}("");
        if (success) {
            // Funds sent successfully
            emit PayoutWithdrawn(payoutAddress, winningBid);
        } else {
            // Fallback to manual withdrawal if automatic transfer fails
            realizedProceeds += winningBid;
        }

        emit AuctionSettled(auctionId, tokenId, auction.highestBidder, winningBid);
    }

    /**
     * @notice Settle multiple auctions at once (batch operation)
     * @dev More gas efficient than calling settleAuction multiple times
     * @dev Continues processing even if some settlements fail
     * @param auctionIds Array of auction IDs to settle
     * @return successes Array indicating which settlements succeeded
     */
    function batchSettleAuctions(
        uint256[] calldata auctionIds
    ) external nonReentrant returns (bool[] memory) {
        bool[] memory successes = new bool[](auctionIds.length);

        for (uint256 i = 0; i < auctionIds.length; i++) {
            uint256 auctionId = auctionIds[i];
            Auction storage auction = auctions[auctionId];

            // Skip if auction doesn't meet settlement criteria
            if (!auction.exists || block.timestamp < auction.endTime || auction.settled) {
                if (!auction.exists) {
                    emit SettlementSkipped(auctionId, "Auction does not exist");
                } else if (block.timestamp < auction.endTime) {
                    emit SettlementSkipped(auctionId, "Auction not ended");
                } else {
                    emit SettlementSkipped(auctionId, "Already settled");
                }
                successes[i] = false;
                continue;
            }

            // If no bids, mark as settled and cancel
            if (auction.highestBidder == address(0)) {
                auction.settled = true;
                tokenToAuction[auction.tokenId] = 0;
                emit AuctionCanceled(auctionId, auction.tokenId);
                successes[i] = true;
                continue;
            }

            // Re-check approval before attempting transfer
            if (!nftContract.isApprovedForAll(address(nftContract), address(this))) {
                emit SettlementSkipped(auctionId, "Missing NFT approval");
                successes[i] = false;
                continue;
            }

            auction.settled = true;
            uint256 tokenId = auction.tokenId;
            uint256 winningBid = auction.highestBid;

            // Move funds from escrow
            escrowedActiveBids -= winningBid;

            // Clear tokenToAuction mapping
            tokenToAuction[tokenId] = 0;

            // Transfer NFT from covenant to winner
            nftContract.safeTransferFrom(address(nftContract), auction.highestBidder, tokenId);

            // Attempt to send proceeds directly to payout address
            (bool success, ) = payable(payoutAddress).call{value: winningBid}("");
            if (success) {
                emit PayoutWithdrawn(payoutAddress, winningBid);
            } else {
                // Fallback to manual withdrawal if automatic transfer fails
                realizedProceeds += winningBid;
            }

            emit AuctionSettled(auctionId, tokenId, auction.highestBidder, winningBid);
            successes[i] = true;
        }

        return successes;
    }

    /**
     * @notice Cancel an auction (emergency only - no bids allowed)
     * @dev Can only cancel if no bids have been placed to prevent owner rug
     * @dev Prevents unfair cancellation after bidders have committed funds
     * @param auctionId Auction ID to cancel
     */
    function cancelAuction(uint256 auctionId) external onlyOwner nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (!auction.exists) revert AuctionNotActive(auctionId);
        if (auction.settled) revert AuctionAlreadySettled(auctionId);

        // Prevent cancellation if bids exist (prevents owner rug)
        if (auction.highestBidder != address(0)) {
            revert CannotCancelWithBids();
        }

        auction.settled = true;
        tokenToAuction[auction.tokenId] = 0;
        emit AuctionCanceled(auctionId, auction.tokenId);
    }

    /**
     * @notice Cancel multiple auctions at once (batch operation)
     * @dev More gas efficient than calling cancelAuction multiple times
     * @dev Continues processing even if some cancellations fail
     * @param auctionIds Array of auction IDs to cancel
     * @return successes Array indicating which cancellations succeeded
     */
    function batchCancelAuctions(
        uint256[] calldata auctionIds
    ) external onlyOwner nonReentrant returns (bool[] memory) {
        bool[] memory successes = new bool[](auctionIds.length);

        for (uint256 i = 0; i < auctionIds.length; i++) {
            uint256 auctionId = auctionIds[i];
            Auction storage auction = auctions[auctionId];

            // Skip if auction doesn't meet cancellation criteria
            if (
                !auction.exists || auction.settled || auction.highestBidder != address(0) // Cannot cancel with bids
            ) {
                successes[i] = false;
                continue;
            }

            auction.settled = true;
            tokenToAuction[auction.tokenId] = 0;
            emit AuctionCanceled(auctionId, auction.tokenId);
            successes[i] = true;
        }

        return successes;
    }

    /**
     * @notice Force settle auction with unsafe transfer (emergency only)
     * @dev Use when winner is a contract without onERC721Received, blocking normal settlement
     * @dev Requires 24-hour grace period after auction end to prevent premature unsafe transfers
     * @dev Uses transferFrom instead of safeTransferFrom - NFT may get stuck if winner can't receive it
     * @dev Only callable by owner to prevent abuse
     * @param auctionId Auction ID to force settle
     * @custom:warning This uses UNSAFE transferFrom. NFT may get stuck in winner contract.
     * @custom:warning Only use after confirming normal settlement fails due to receiver issue.
     */
    function forceSettleWithUnsafeTransfer(uint256 auctionId) external onlyOwner nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (!auction.exists) revert AuctionNotActive(auctionId);
        if (auction.settled) revert AuctionAlreadySettled(auctionId);

        // Must wait 24 hours after auction end before using unsafe transfer
        if (block.timestamp < auction.endTime + UNSAFE_TRANSFER_GRACE_PERIOD) {
            revert UnsafeTransferNotReady(auction.endTime + UNSAFE_TRANSFER_GRACE_PERIOD);
        }

        // If no bids, mark as settled and cancel
        if (auction.highestBidder == address(0)) {
            auction.settled = true;
            tokenToAuction[auction.tokenId] = 0;
            emit AuctionCanceled(auctionId, auction.tokenId);
            return;
        }

        // Re-check approval before attempting transfer
        if (!nftContract.isApprovedForAll(address(nftContract), address(this))) {
            revert ApprovalMissing();
        }

        auction.settled = true;
        uint256 tokenId = auction.tokenId;
        uint256 winningBid = auction.highestBid;

        // Move funds from escrow
        escrowedActiveBids -= winningBid;

        // Clear tokenToAuction mapping
        tokenToAuction[tokenId] = 0;

        // UNSAFE TRANSFER: Use transferFrom instead of safeTransferFrom
        // WARNING: NFT may get stuck if winner is a contract without ERC721 support
        nftContract.transferFrom(address(nftContract), auction.highestBidder, tokenId);

        // Attempt to send proceeds directly to payout address
        (bool success, ) = payable(payoutAddress).call{value: winningBid}("");
        if (success) {
            emit PayoutWithdrawn(payoutAddress, winningBid);
        } else {
            // Fallback to manual withdrawal if automatic transfer fails
            realizedProceeds += winningBid;
        }

        emit AuctionSettled(auctionId, tokenId, auction.highestBidder, winningBid);
    }

    /**
     * @notice Withdraw pending funds
     * @dev Uses withdrawal pattern for safety (pull over push)
     */
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NoFundsToWithdraw();

        pendingWithdrawals[msg.sender] = 0;
        totalPendingWithdrawals -= amount;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) {
            // Restore balance on failure
            pendingWithdrawals[msg.sender] = amount;
            totalPendingWithdrawals += amount;
            revert WithdrawalFailed();
        }

        emit FundsWithdrawn(msg.sender, amount);
    }

    // ============ External Functions - Owner Only ============

    /**
     * @notice Update the extension window
     * @dev Window must be <= 24 hours to prevent accidental misconfiguration
     * @param newWindow New extension window in seconds
     */
    function updateExtensionWindow(uint256 newWindow) external onlyOwner {
        if (newWindow > 24 hours) revert InvalidExtensionParam();

        uint256 previousWindow = extensionWindow;
        extensionWindow = newWindow;

        emit ExtensionWindowUpdated(previousWindow, newWindow);
    }

    /**
     * @notice Update the extension duration
     * @dev Duration must be <= 24 hours to prevent accidental misconfiguration
     * @param newDuration New extension duration in seconds
     */
    function updateExtensionDuration(uint256 newDuration) external onlyOwner {
        if (newDuration > 24 hours) revert InvalidExtensionParam();

        uint256 previousDuration = extensionDuration;
        extensionDuration = newDuration;

        emit ExtensionDurationUpdated(previousDuration, newDuration);
    }

    /**
     * @notice Update the payout address
     * @param newPayoutAddress New address to receive auction proceeds
     */
    function updatePayoutAddress(address newPayoutAddress) external onlyOwner {
        if (newPayoutAddress == address(0)) revert InvalidPayoutAddress();

        address previousAddress = payoutAddress;
        payoutAddress = newPayoutAddress;

        emit PayoutAddressUpdated(previousAddress, newPayoutAddress);
    }

    /**
     * @notice Pause the contract (emergency stop)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Withdraw auction proceeds to payout address
     * @dev Only withdraws realized proceeds from settled auctions
     * @dev Does not allow withdrawing escrowed bids from active auctions
     * @dev This prevents owner from taking funds before NFT delivery
     */
    function withdrawProceeds() external onlyOwner nonReentrant {
        uint256 amount = realizedProceeds;
        if (amount == 0) revert NoFundsToWithdraw();

        // Clear realized proceeds before transfer
        realizedProceeds = 0;

        (bool success, ) = payable(payoutAddress).call{value: amount}("");
        if (!success) {
            // Restore on failure
            realizedProceeds = amount;
            revert WithdrawalFailed();
        }

        emit PayoutWithdrawn(payoutAddress, amount);
    }

    /**
     * @notice Sweep excess ETH not part of any ledger (escrow/pending/realized)
     * @dev Prevents stranded funds from force-sends or other unaccounted sources
     * @dev Cannot rug bidders - only moves funds outside the three accounting sets
     * @dev Useful for recovering dust or misplaced funds
     */
    function sweepExcessETH() external onlyOwner nonReentrant {
        uint256 accounted = escrowedActiveBids + totalPendingWithdrawals + realizedProceeds;
        uint256 bal = address(this).balance;
        if (bal <= accounted) revert NoFundsToWithdraw();

        uint256 excess = bal - accounted;

        (bool success, ) = payable(payoutAddress).call{value: excess}("");
        if (!success) revert WithdrawalFailed();

        emit PayoutWithdrawn(payoutAddress, excess);
    }

    /**
     * @notice Recover stuck funds from users who cannot receive ETH
     * @dev Requires contract to be paused - this is a deliberate governance action
     * @dev Tries to send to user first (with gas limit); if that fails, sends to payout
     * @dev This prevents fund-locking from contracts with no receive/fallback functions
     * @param user Address of user whose stuck funds should be recovered
     */
    function recoverStuckFunds(address user) external onlyOwner whenPaused nonReentrant {
        uint256 amount = pendingWithdrawals[user];
        if (amount == 0) revert NoStuckFundsForUser();

        // Try to send to user first (with gas limit to prevent griefing)
        (bool userSuccess, ) = payable(user).call{value: amount, gas: 10000}("");

        if (userSuccess) {
            // User can receive - complete normal withdrawal
            pendingWithdrawals[user] = 0;
            totalPendingWithdrawals -= amount;
            emit FundsWithdrawn(user, amount);
        } else {
            // User cannot receive - recover to payout address
            pendingWithdrawals[user] = 0;
            totalPendingWithdrawals -= amount;

            (bool payoutSuccess, ) = payable(payoutAddress).call{value: amount}("");
            if (!payoutSuccess) {
                // Restore state if payout also fails
                pendingWithdrawals[user] = amount;
                totalPendingWithdrawals += amount;
                revert WithdrawalFailed();
            }

            emit StuckFundsRecovered(user, amount);
        }
    }

    /**
     * @notice Owner can withdraw pending funds on behalf of a user (emergency only)
     * @param user Address to withdraw funds for
     * @dev Only callable by owner when contract is paused
     * @dev Sends to payoutAddress, not to user
     * @dev Useful if user's address can't receive ETH or in emergency situations
     */
    function ownerWithdrawFor(address user) external onlyOwner whenPaused nonReentrant {
        uint256 amount = pendingWithdrawals[user];
        if (amount == 0) revert NoFundsToWithdraw();

        // Clear user's pending balance
        pendingWithdrawals[user] = 0;
        totalPendingWithdrawals -= amount;

        // Send to payout address
        (bool success, ) = payable(payoutAddress).call{value: amount}("");
        if (!success) {
            // Restore state if transfer fails
            pendingWithdrawals[user] = amount;
            totalPendingWithdrawals += amount;
            revert WithdrawalFailed();
        }

        emit OwnerWithdrewFor(user, payoutAddress, amount);
    }

    /**
     * @notice Emergency function to correct accounting mismatch
     * @dev Only callable by owner when contract is paused
     * @dev Use with extreme caution - only for fixing critical accounting errors
     * @param user Address whose pending withdrawal to correct
     * @param correctAmount Correct pending withdrawal amount for the user
     */
    function emergencyCorrectAccounting(
        address user,
        uint256 correctAmount
    ) external onlyOwner whenPaused nonReentrant {
        uint256 oldAmount = pendingWithdrawals[user];

        // Update total first (prevents underflow if correctAmount < oldAmount)
        if (correctAmount > oldAmount) {
            totalPendingWithdrawals += (correctAmount - oldAmount);
        } else {
            totalPendingWithdrawals -= (oldAmount - correctAmount);
        }

        pendingWithdrawals[user] = correctAmount;

        emit AccountingCorrected(user, oldAmount, correctAmount);
    }

    // ============ External View Functions ============

    /**
     * @notice Get auction information
     * @param auctionId Auction ID
     * @return Auction struct data
     */
    function getAuction(uint256 auctionId) external view returns (Auction memory) {
        return auctions[auctionId];
    }

    /**
     * @notice Get auction by token ID (convenience function)
     * @param tokenId Token ID
     * @return Auction struct data (will have exists=false if no auction for token)
     */
    function getAuctionByToken(uint256 tokenId) external view returns (Auction memory) {
        uint256 auctionId = tokenToAuction[tokenId];
        return auctions[auctionId];
    }

    /**
     * @notice Check if an auction is active (exists, not settled, started, not ended)
     * @param auctionId Auction ID
     * @return True if auction is active and accepting bids
     */
    function isAuctionActive(uint256 auctionId) external view returns (bool) {
        Auction storage auction = auctions[auctionId];
        return
            auction.exists &&
            !auction.settled &&
            block.timestamp >= auction.startTime &&
            block.timestamp < auction.endTime;
    }

    /**
     * @notice Get time remaining in an auction
     * @param auctionId Auction ID
     * @return Time remaining in seconds (0 if ended or doesn't exist)
     */
    function getTimeRemaining(uint256 auctionId) external view returns (uint256) {
        Auction storage auction = auctions[auctionId];
        if (!auction.exists || block.timestamp >= auction.endTime) return 0;
        return auction.endTime - block.timestamp;
    }

    /**
     * @notice Get pending withdrawal amount for a user
     * @param user User address
     * @return Amount available to withdraw
     */
    function getPendingWithdrawal(address user) external view returns (uint256) {
        return pendingWithdrawals[user];
    }

    /**
     * @notice Get next auction ID
     * @return Next auction ID that will be created
     */
    function nextAuctionId() external view returns (uint256) {
        return _auctionIdCounter;
    }

    /**
     * @notice Get multiple auctions at once
     * @param auctionIds Array of auction IDs to retrieve
     * @return Array of Auction struct data
     */
    function getAuctions(uint256[] calldata auctionIds) external view returns (Auction[] memory) {
        Auction[] memory result = new Auction[](auctionIds.length);
        for (uint256 i = 0; i < auctionIds.length; i++) {
            result[i] = auctions[auctionIds[i]];
        }
        return result;
    }

    /**
     * @notice Get auction IDs for given token IDs
     * @param tokenIds Array of token IDs
     * @return Array of auction IDs (0 if no active auction for token)
     */
    function getAuctionIdsByTokens(
        uint256[] calldata tokenIds
    ) external view returns (uint256[] memory) {
        uint256[] memory result = new uint256[](tokenIds.length);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            result[i] = tokenToAuction[tokenIds[i]];
        }
        return result;
    }

    /**
     * @notice Get full auction data for multiple tokens (convenience function)
     * @param tokenIds Array of token IDs
     * @return Array of Auction structs (will have exists=false if no auction for token)
     */
    function getAuctionsByTokens(
        uint256[] calldata tokenIds
    ) external view returns (Auction[] memory) {
        Auction[] memory result = new Auction[](tokenIds.length);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 auctionId = tokenToAuction[tokenIds[i]];
            result[i] = auctions[auctionId];
        }
        return result;
    }

    /**
     * @notice Check if auction needs settlement
     * @param auctionId Auction ID
     * @return True if auction ended and not yet settled
     */
    function needsSettlement(uint256 auctionId) external view returns (bool) {
        Auction storage auction = auctions[auctionId];
        return auction.exists && !auction.settled && block.timestamp >= auction.endTime;
    }

    /**
     * @notice Get contract balance accounting info
     * @return totalBalance Total ETH in contract
     * @return pendingTotal Total pending withdrawals for outbid bidders
     * @return escrowedBids Total escrowed in active (unsettled) auctions
     * @return realizedAmount Realized proceeds available for owner withdrawal
     */
    function getBalanceInfo()
        external
        view
        returns (
            uint256 totalBalance,
            uint256 pendingTotal,
            uint256 escrowedBids,
            uint256 realizedAmount
        )
    {
        totalBalance = address(this).balance;
        pendingTotal = totalPendingWithdrawals;
        escrowedBids = escrowedActiveBids;
        realizedAmount = realizedProceeds;
    }

    /**
     * @notice Get all active auction IDs with pagination
     * @dev Active means: exists, not settled, started, not ended
     * @dev WARNING: This iterates through all auctions - use pagination for large datasets
     * @param startIndex Starting auction ID (inclusive)
     * @param endIndex Ending auction ID (exclusive, use nextAuctionId() for current max)
     * @return activeAuctionIds Array of active auction IDs
     */
    function getAllActiveAuctions(
        uint256 startIndex,
        uint256 endIndex
    ) external view returns (uint256[] memory) {
        // First count how many active auctions there are
        uint256 count = 0;
        for (uint256 i = startIndex; i < endIndex && i < _auctionIdCounter; i++) {
            Auction storage auction = auctions[i];
            if (
                auction.exists &&
                !auction.settled &&
                block.timestamp >= auction.startTime &&
                block.timestamp < auction.endTime
            ) {
                count++;
            }
        }

        // Create result array and populate it
        uint256[] memory result = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = startIndex; i < endIndex && i < _auctionIdCounter; i++) {
            Auction storage auction = auctions[i];
            if (
                auction.exists &&
                !auction.settled &&
                block.timestamp >= auction.startTime &&
                block.timestamp < auction.endTime
            ) {
                result[index] = i;
                index++;
            }
        }

        return result;
    }

    /**
     * @notice Get all auctions that need settlement
     * @dev Returns auction IDs where the auction has ended but not yet settled
     * @param startIndex Starting auction ID (inclusive)
     * @param endIndex Ending auction ID (exclusive)
     * @return auctionIds Array of auction IDs needing settlement
     */
    function getAuctionsNeedingSettlement(
        uint256 startIndex,
        uint256 endIndex
    ) external view returns (uint256[] memory) {
        // First count
        uint256 count = 0;
        for (uint256 i = startIndex; i < endIndex && i < _auctionIdCounter; i++) {
            Auction storage auction = auctions[i];
            if (auction.exists && !auction.settled && block.timestamp >= auction.endTime) {
                count++;
            }
        }

        // Populate result
        uint256[] memory result = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = startIndex; i < endIndex && i < _auctionIdCounter; i++) {
            Auction storage auction = auctions[i];
            if (auction.exists && !auction.settled && block.timestamp >= auction.endTime) {
                result[index] = i;
                index++;
            }
        }

        return result;
    }

    /**
     * @notice Get all auctions where a specific user is the current highest bidder
     * @dev Only returns active (unsettled) auctions
     * @param user Address to check
     * @return auctionIds Array of auction IDs where user is winning
     */
    function getUserActiveAuctions(address user) external view returns (uint256[] memory) {
        // First count
        uint256 count = 0;
        for (uint256 i = MIN_AUCTION_ID; i < _auctionIdCounter; i++) {
            Auction storage auction = auctions[i];
            if (auction.exists && !auction.settled && auction.highestBidder == user) {
                count++;
            }
        }

        // Populate result
        uint256[] memory result = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = MIN_AUCTION_ID; i < _auctionIdCounter; i++) {
            Auction storage auction = auctions[i];
            if (auction.exists && !auction.settled && auction.highestBidder == user) {
                result[index] = i;
                index++;
            }
        }

        return result;
    }

    // ============ Bid History View Functions ============

    /**
     * @notice Get the total number of bids for an auction
     * @param auctionId Auction ID to query
     * @return Total number of bids in history
     */
    function getBidHistoryLength(uint256 auctionId) external view returns (uint256) {
        return _bidHistory[auctionId].length;
    }

    /**
     * @notice Get a slice of bid history for an auction
     * @param auctionId Auction ID to query
     * @param startIndex Starting index (inclusive)
     * @param endIndex Ending index (exclusive)
     * @return Array of BidRecord structs
     * @dev Returns empty array if startIndex >= history length
     * @dev Caps endIndex at history length automatically
     */
    function getBidHistory(
        uint256 auctionId,
        uint256 startIndex,
        uint256 endIndex
    ) external view returns (BidRecord[] memory) {
        BidRecord[] storage history = _bidHistory[auctionId];

        // Validate indices
        if (startIndex >= history.length) {
            return new BidRecord[](0);
        }

        // Cap endIndex at array length
        if (endIndex > history.length) {
            endIndex = history.length;
        }

        // Build result
        uint256 resultLength = endIndex - startIndex;
        BidRecord[] memory result = new BidRecord[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            result[i] = history[startIndex + i];
        }

        return result;
    }

    /**
     * @notice Get the most recent N bids for an auction
     * @param auctionId Auction ID to query
     * @param count Number of recent bids to return
     * @return Array of BidRecord structs (most recent last)
     * @dev Returns all bids if count > history length
     */
    function getRecentBidHistory(
        uint256 auctionId,
        uint256 count
    ) external view returns (BidRecord[] memory) {
        BidRecord[] storage history = _bidHistory[auctionId];

        if (history.length == 0) {
            return new BidRecord[](0);
        }

        uint256 resultCount = count > history.length ? history.length : count;
        uint256 startIndex = history.length - resultCount;

        BidRecord[] memory result = new BidRecord[](resultCount);
        for (uint256 i = 0; i < resultCount; i++) {
            result[i] = history[startIndex + i];
        }

        return result;
    }

    /**
     * @notice Get bid history for multiple auctions (batch query)
     * @param auctionIds Array of auction IDs to query
     * @param startIndex Starting index for each auction
     * @param endIndex Ending index for each auction
     * @return Array of BidRecord arrays (one per auction)
     */
    function getBidHistoryBatch(
        uint256[] calldata auctionIds,
        uint256 startIndex,
        uint256 endIndex
    ) external view returns (BidRecord[][] memory) {
        BidRecord[][] memory results = new BidRecord[][](auctionIds.length);

        for (uint256 i = 0; i < auctionIds.length; i++) {
            results[i] = this.getBidHistory(auctionIds[i], startIndex, endIndex);
        }

        return results;
    }

    /**
     * @notice Get recent bid history for multiple auctions (batch query)
     * @param auctionIds Array of auction IDs to query
     * @param count Number of recent bids to return per auction
     * @return Array of BidRecord arrays (one per auction)
     */
    function getRecentBidHistoryBatch(
        uint256[] calldata auctionIds,
        uint256 count
    ) external view returns (BidRecord[][] memory) {
        BidRecord[][] memory results = new BidRecord[][](auctionIds.length);

        for (uint256 i = 0; i < auctionIds.length; i++) {
            results[i] = this.getRecentBidHistory(auctionIds[i], count);
        }

        return results;
    }

    // ============ Receive Functions ============

    /**
     * @notice Prevent accidental ETH sends
     */
    receive() external payable {
        revert("Use bid() function");
    }

    /**
     * @notice Fallback function
     */
    fallback() external payable {
        revert("Use bid() function");
    }
}