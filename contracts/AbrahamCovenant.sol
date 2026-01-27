// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AbrahamCovenant
 * @author Eden Platform
 * @notice NFT contract for Abraham Covenant collection with controlled minting
 * @dev Implements ERC721 with Abraham controlling daily work and Owner controlling sales mechanics
 * @dev Abraham controls daily work commitments and work cycle
 * @dev Owner (deployer) controls sales mechanism configuration
 * @dev Inherits ERC721Holder to safely receive NFTs minted to itself (covenant pattern)
 */
contract AbrahamCovenant is ERC721, ERC721Holder, Ownable, ReentrancyGuard {
    // ============ Events ============

    event NFTMinted(uint256 indexed tokenId, address indexed recipient);
    event DailyWorkCommitted(uint256 indexed dayNumber, uint256 indexed tokenId, uint256 timestamp);
    event DayMissed(uint256 indexed dayNumber, uint256 indexed tokenId);
    event SalesMechanicUpdated(address previousMechanic, address newMechanic);
    event MechanicOperatorSet(address indexed mechanic, bool approved);
    event SalesMechanicRotated(address indexed previous, address indexed current, bool approved);
    event RestDayTaken(uint256 timestamp, uint256 cycleSize);
    event WorkCycleUpdated(uint256 previousCycle, uint256 newCycle);
    event CovenantBreached(uint256 timestamp, uint256 lastCommitTimestamp);
    event CovenantStarted(uint256 timestamp);
    event AbrahamAddressUpdated(address indexed previousAbraham, address indexed newAbraham);
    event SalesTransfer(
    address indexed from,        // Always address(this) - covenant contract
    address indexed to,          // Buyer
    uint256 indexed tokenId,     // Token being transferred
    address salesMechanic        // Which mechanic performed the sale
);

event BulkSalesTransfer(
    address indexed from,        // Always address(this)
    address indexed to,          // Buyer
    uint256[] tokenIds,          // Multiple tokens transferred
    address salesMechanic        // Which mechanic performed the sale
);

    // ============ Errors ============

    error MaxSupplyExceeded(uint256 requested, uint256 maxSupply);
    error MaxSupplyCannotBeZero();
    error InvalidRecipient();
    error AlreadyCommittedToday();
    error OnlyAbraham();
    error EmptyTokenURI();
    error MustRestBeforeNextWork();
    error NotYetTimeToRest();
    error AlreadyRested();
    error AlreadyRestedToday();
    error CannotRestOnSameDayAsWork();
    error SalesMechanicNotSet();
    error SalesMechanicCannotBeSelf();
    error CovenantBroken();
    error CovenantNotStarted();
    error CovenantAlreadyStarted();
    error StartTimeWouldCauseBreach(uint256 timeSinceStart, uint256 maxAllowed);

    // ============ State Variables ============

    /// @notice Current token ID counter (starts at 0)
    uint256 private _tokenIdCounter = 0;

    /// @notice Maximum number of tokens that can ever be minted (immutable for trust)
    uint256 public immutable maxSupply;

    /// @notice Sales mechanism address (for NFT approvals)
    address public salesMechanic;

    /// @notice Abraham's address (the only one who can commit daily work)
    address public abraham;

    /// @notice Mapping from token ID to token URI (each piece has unique metadata)
    mapping(uint256 => string) private _tokenURIs;

    /// @notice Tracks daily work commitments (optimized for gas)
    struct DailyWork {
        uint256 tokenId; // Links to the minted NFT
        uint256 timestamp; // When the work was committed
        bool exists; // True if work was committed on this day (handles tokenId 0 case)
    }

    /// @notice Mapping from day number to daily work
    mapping(uint256 => DailyWork) internal _dailyWorks;

    /// @notice Last day Abraham committed work (prevents multiple commits per day)
    uint256 public lastCommitDay;

    /// @notice Last day Abraham took rest (prevents multiple rest calls per day)
    uint256 public lastRestDay;

    /// @notice Covenant start timestamp - used as epoch for day calculations
    /// @dev Set to 0 initially, Abraham must call startCovenant() to begin
    uint256 public covenantStartTimestamp;

    /// @notice Number of consecutive works before rest is required (0 = infinite, no rest required)
    uint256 public daysOfWork;

    /// @notice Count of works completed since last rest
    uint256 public worksSinceLastRest;

    /// @notice Tracks if Abraham needs to take a rest day before next commit
    bool public needsRest;

    /// @notice Timestamp of the last commit (for breach detection)
    uint256 public lastCommitTimestamp;

    /// @notice Grace period in seconds (7 days = 604800)
    uint256 public constant GRACE_PERIOD = 7 days;

    /// @notice Whether the covenant has been broken
    bool public covenantBroken;

    // ============ Constructor ============

    /**
     * @notice Initializes the AbrahamCovenant NFT contract
     * @param _name NFT collection name
     * @param _symbol NFT collection symbol
     * @param _owner Owner address (deployer, controls sales mechanics)
     * @param _abraham Abraham's address (controls daily work commitments)
     * @param _maxSupply Maximum number of tokens that can be minted (immutable)
     * @param _daysOfWork Number of days to work before rest (0 = infinite, no rest days)
     */
    constructor(
        string memory _name,
        string memory _symbol,
        address _owner,
        address _abraham,
        uint256 _maxSupply,
        uint256 _daysOfWork
    ) ERC721(_name, _symbol) Ownable(_owner) {
        if (_maxSupply == 0) revert MaxSupplyCannotBeZero();
        if (_abraham == address(0)) revert InvalidRecipient();

        abraham = _abraham;
        maxSupply = _maxSupply;
        covenantStartTimestamp = 0; // Not started yet, Abraham must call startCovenant()
        daysOfWork = _daysOfWork;
        worksSinceLastRest = 0;
        needsRest = false;
        lastCommitTimestamp = 0;
        covenantBroken = false;

        emit WorkCycleUpdated(0, _daysOfWork);
    }

    // ============ Modifiers ============

    /**
     * @dev Ensures only Abraham can call the function
     */
    modifier onlyAbraham() {
        if (msg.sender != abraham) {
            revert OnlyAbraham();
        }
        _;
    }

    // ============ Internal Functions ============

    /**
     * @dev Internal helper to check if covenant has actually started (past start timestamp)
     * @return True if covenant start time has been reached
     */
    function _hasStarted() internal view returns (bool) {
        return covenantStartTimestamp != 0 && block.timestamp >= covenantStartTimestamp;
    }

    /**
     * @dev Safe helper to calculate time elapsed since a timestamp
     * @dev Returns 0 if current time is before the timestamp (future-proofing)
     * @param t The timestamp to measure from
     * @return Time elapsed in seconds, or 0 if t is in the future
     */
    function _timeSince(uint256 t) internal view returns (uint256) {
        return block.timestamp > t ? block.timestamp - t : 0;
    }

    /**
     * @dev Internal function to check and enforce covenant breach
     * @dev Called at the start of commitDailyWork() and takeRestDay()
     * @dev Reverts if covenant is broken or becomes broken during this call
     */
    function _checkAndEnforceCovenantBreach() internal {
        // Covenant must be started
        if (covenantStartTimestamp == 0) revert CovenantNotStarted();

        // If already marked as broken, revert immediately
        if (covenantBroken) revert CovenantBroken();

        // Calculate time since last commit
        uint256 timeSinceLastCommit;
        if (lastCommitTimestamp == 0) {
            // No commits yet - check time since covenant start
            timeSinceLastCommit = _timeSince(covenantStartTimestamp);
        } else {
            // Check time since last actual commit
            timeSinceLastCommit = _timeSince(lastCommitTimestamp);
        }

        // Check if grace period has expired
        if (timeSinceLastCommit >= GRACE_PERIOD) {
            covenantBroken = true;
            emit CovenantBreached(block.timestamp, lastCommitTimestamp);
            revert CovenantBroken();
        }
    }

function _update(
    address to,
    uint256 tokenId,
    address auth
) internal virtual override returns (address) {
    address from = _ownerOf(tokenId);
    
    // Call parent _update first to perform the actual transfer
    address updatedFrom = super._update(to, tokenId, auth);
    
    // Check if this is a transfer FROM the covenant contract (sales mechanic transfer)
    // from == address(this) means token is leaving the covenant
    if (from == address(this) && to != address(0)) {
        // Only emit if salesMechanic is set
        if (salesMechanic != address(0)) {
            // Check if caller is salesMechanic or approved by salesMechanic
            bool isMechanicOrApproved = 
                msg.sender == salesMechanic || 
                isApprovedForAll(salesMechanic, msg.sender) ||
                isApprovedForAll(address(this), salesMechanic);
            
            if (isMechanicOrApproved) {
                emit SalesTransfer(address(this), to, tokenId, salesMechanic);
            }
        }
    }
    
    return updatedFrom;
}

    // ============ External Functions - Daily Covenant ============

    /**
     * @notice Abraham commits his daily work and mints NFT to covenant
     * @dev Can only be called by Abraham, once per day
     * @dev If daysOfWork > 0, enforces rest after completing the cycle
     * @dev Token ID increments sequentially based on works completed (not day number)
     * @param uri IPFS URI for this piece's metadata (e.g., "ipfs://QmAbc...")
     * @return tokenId The ID of the minted token
     */
    function commitDailyWork(
        string calldata uri
    ) external nonReentrant onlyAbraham returns (uint256) {
        // Covenant must be started
        if (!_hasStarted()) revert CovenantNotStarted();

        // Check covenant breach FIRST (will revert if broken)
        _checkAndEnforceCovenantBreach();

        if (bytes(uri).length == 0) revert EmptyTokenURI();

        // Calculate current day number (days since covenant start)
        uint256 currentDay = _timeSince(covenantStartTimestamp) / 1 days;

        // Ensure Abraham hasn't already committed today
        if (_dailyWorks[currentDay].exists) {
            revert AlreadyCommittedToday();
        }

        // Enforce rest day if required (only if daysOfWork > 0)
        if (needsRest) {
            revert MustRestBeforeNextWork();
        }

        // Calculate missed days and mint null tokens to Abraham
        uint256 daysMissed = 0;
        if (lastCommitDay > 0 || _tokenIdCounter > 0) {
            // Calculate how many days were skipped
            daysMissed = currentDay - lastCommitDay - 1;
        }

        // Check max supply including missed days (safer subtraction-based check)
        uint256 remaining = maxSupply - _tokenIdCounter; // reverts if counter > maxSupply
        uint256 toMint = daysMissed + 1; // null tokens + current work
        if (toMint > remaining) {
            revert MaxSupplyExceeded(_tokenIdCounter + toMint, maxSupply);
        }

        // Mint null tokens for missed days to Abraham
        for (uint256 i = 0; i < daysMissed; i++) {
            uint256 missedDay = lastCommitDay + i + 1;
            uint256 missedTokenId = _tokenIdCounter;

            // Store the missed day work (null token)
            _dailyWorks[missedDay] = DailyWork({
                tokenId: missedTokenId,
                timestamp: 0, // Zero timestamp for missed days
                exists: true
            });

            // Store empty token URI
            _tokenURIs[missedTokenId] = "";

            // Mint null token to Abraham (not covenant contract)
            _safeMint(abraham, missedTokenId);

            // Increment counter
            unchecked {
                _tokenIdCounter++;
            }

            emit DayMissed(missedDay, missedTokenId);
        }

        // Token ID = number of works completed (sequential, not day-based)
        uint256 tokenId = _tokenIdCounter;

        // Store the daily work
        _dailyWorks[currentDay] = DailyWork({
            tokenId: tokenId,
            timestamp: block.timestamp,
            exists: true
        });

        // Store token URI for this specific token
        _tokenURIs[tokenId] = uri;

        // Update last commit day
        lastCommitDay = currentDay;

        // Mint NFT to covenant contract (self)
        _safeMint(address(this), tokenId);

        // Note: Sales mechanic uses operator approval (setApprovalForAll)
        // instead of per-token approvals to handle mechanic rotations

        // Increment counter (next token ID)
        unchecked {
            _tokenIdCounter = tokenId + 1;
        }

        // Track work cycle (if daysOfWork > 0, enforce rest)
        if (daysOfWork > 0) {
            worksSinceLastRest++;

            // If completed the work cycle, require rest before next commit
            if (worksSinceLastRest >= daysOfWork) {
                needsRest = true;
            }
        }

        // Update last commit timestamp for breach detection
        lastCommitTimestamp = block.timestamp;

        emit DailyWorkCommitted(currentDay, tokenId, block.timestamp);
        emit NFTMinted(tokenId, address(this));

        return tokenId;
    }

    /**
     * @notice Abraham takes a rest day after completing work cycle
     * @dev Can only be called after completing daysOfWork commits
     * @dev Can be called anytime during a calendar day (like commitDailyWork)
     * @dev Cannot be called on same day as work commit
     * @dev Resets work counter and allows next cycle to begin
     */
    function takeRestDay() external nonReentrant onlyAbraham {
        // Covenant must be started
        if (!_hasStarted()) revert CovenantNotStarted();

        // Check covenant breach FIRST (will revert if broken)
        _checkAndEnforceCovenantBreach();

        // If daysOfWork is 0 (infinite mode), rest is not required
        if (daysOfWork == 0) {
            revert NotYetTimeToRest();
        }

        // Must have completed at least daysOfWork commits
        if (worksSinceLastRest < daysOfWork) {
            revert NotYetTimeToRest();
        }

        // Must need rest (can't rest twice in a row without working)
        if (!needsRest) {
            revert AlreadyRested();
        }

        // Calculate current day number (days since covenant start)
        uint256 currentDay = _timeSince(covenantStartTimestamp) / 1 days;

        // Cannot rest on same day as work commit
        if (currentDay == lastCommitDay) {
            revert CannotRestOnSameDayAsWork();
        }

        // Cannot rest multiple times on same day
        if (currentDay == lastRestDay) {
            revert AlreadyRestedToday();
        }

        // Update last rest day
        lastRestDay = currentDay;

        // Reset counters
        worksSinceLastRest = 0;
        needsRest = false;

        emit RestDayTaken(block.timestamp, daysOfWork);
    }

    /**
     * @notice Start the covenant and begin the grace period timer
     * @dev Can only be called once by Abraham
     * @dev Sets the covenant start timestamp which begins the daily work cycle
     * @dev Must be called before commitDailyWork() or takeRestDay()
     * @dev Start time cannot be more than GRACE_PERIOD ago (prevents immediate breach)
     * @param _startTimestamp The timestamp when the covenant begins (use block.timestamp for immediate start, or future timestamp for scheduled start)
     */
    function startCovenant(uint256 _startTimestamp) external onlyAbraham {
        // Can only start once
        if (covenantStartTimestamp != 0) revert CovenantAlreadyStarted();

        // Ensure start time won't cause immediate breach
        uint256 timeSinceStart = block.timestamp > _startTimestamp
            ? block.timestamp - _startTimestamp
            : 0;

        if (timeSinceStart >= GRACE_PERIOD) {
            revert StartTimeWouldCauseBreach(timeSinceStart, GRACE_PERIOD);
        }

        covenantStartTimestamp = _startTimestamp;

        // Set lastCommitTimestamp to start time so breach checking begins from that moment
        lastCommitTimestamp = _startTimestamp;

        emit CovenantStarted(_startTimestamp);
    }

    // ============ External Functions - Minting ============

    // ============ External Functions - Abraham Only ============

    /**
     * @notice Update the sales mechanism address
     * @dev Can only be called by owner (deployer)
     * @dev Does NOT automatically grant operator approval - call setMechanicOperator separately
     * @param _salesMechanic New sales mechanism address
     */
    function updateSalesMechanic(address _salesMechanic) external onlyOwner {
        // Prevent self-approval edge case (would revert in OZ _setApprovalForAll)
        if (_salesMechanic == address(this)) revert SalesMechanicCannotBeSelf();

        address previousMechanic = salesMechanic;
        salesMechanic = _salesMechanic;

        emit SalesMechanicUpdated(previousMechanic, _salesMechanic);
    }

    /**
     * @notice Set operator approval for the current sales mechanic
     * @dev Can only be called by owner (deployer)
     * @dev Uses setApprovalForAll to grant/revoke operator status
     * @dev This allows the mechanic to transfer ALL tokens owned by the contract
     * @dev Handles mechanic rotations cleanly - revoke old, approve new
     * @param approved True to grant approval, false to revoke
     */
    function setMechanicOperator(bool approved) external onlyOwner {
        address mechanic = salesMechanic;
        if (mechanic == address(0)) revert SalesMechanicNotSet();

        _setApprovalForAll(address(this), mechanic, approved);

        emit MechanicOperatorSet(mechanic, approved);
    }

    /**
     * @notice Atomically rotate sales mechanic (revoke old, update address, optionally approve new)
     * @dev Can only be called by owner (deployer)
     * @dev Recommended for mechanic rotations - handles approval management automatically
     * @dev Revokes old mechanic's approval, updates address, optionally approves new mechanic
     * @param _newMechanic New sales mechanism address (can be address(0) to clear)
     * @param approveNew True to grant operator approval to new mechanic, false to skip
     */
    function rotateSalesMechanic(address _newMechanic, bool approveNew) external onlyOwner {
        // Prevent self-approval edge case (would revert in OZ _setApprovalForAll)
        if (_newMechanic == address(this)) revert SalesMechanicCannotBeSelf();

        address prev = salesMechanic;

        // Revoke old operator if set
        if (prev != address(0)) {
            _setApprovalForAll(address(this), prev, false);
            emit MechanicOperatorSet(prev, false);
        }

        salesMechanic = _newMechanic;
        emit SalesMechanicUpdated(prev, _newMechanic);

        // Approve new mechanic if requested and not address(0)
        if (_newMechanic != address(0) && approveNew) {
            _setApprovalForAll(address(this), _newMechanic, true);
            emit MechanicOperatorSet(_newMechanic, true);
        }

        emit SalesMechanicRotated(prev, _newMechanic, approveNew);
    }

// ============ External Functions - Sales Mechanism ============

/**
 * @notice Sales mechanic transfer function with proper event emission
 * @dev Must be used instead of direct transferFrom for sales to emit proper events
 * @param to Address to receive the token
 * @param tokenId Token ID to transfer
 */
function salesTransfer(address to, uint256 tokenId) external {
    if (salesMechanic == address(0)) revert SalesMechanicNotSet();
    
    // Check if caller is authorized
    if (msg.sender != salesMechanic && !isApprovedForAll(salesMechanic, msg.sender)) {
        revert OnlyAbraham();
    }
    
    // Ensure sales mechanic has operator approval
    if (!isApprovedForAll(address(this), salesMechanic)) {
        revert SalesMechanicNotSet();
    }
    
    // Transfer token (will also call _update)
    safeTransferFrom(address(this), to, tokenId);
    
    // Emit event (also emitted in _update, but explicit here)
    emit SalesTransfer(address(this), to, tokenId, salesMechanic);
}

/**
 * @notice Sales mechanic bulk transfer function
 * @dev More gas efficient than multiple single transfers
 * @param to Address to receive the tokens
 * @param tokenIds Array of token IDs to transfer
 */
function salesBulkTransfer(address to, uint256[] calldata tokenIds) external {
    if (salesMechanic == address(0)) revert SalesMechanicNotSet();
    
    // Check if caller is authorized
    if (msg.sender != salesMechanic && !isApprovedForAll(salesMechanic, msg.sender)) {
        revert OnlyAbraham();
    }
    
    // Ensure sales mechanic has operator approval
    if (!isApprovedForAll(address(this), salesMechanic)) {
        revert SalesMechanicNotSet();
    }
    
    // Track token IDs for bulk event
    uint256[] memory transferredTokenIds = new uint256[](tokenIds.length);
    
    for (uint256 i = 0; i < tokenIds.length; i++) {
        // Transfer each token
        safeTransferFrom(address(this), to, tokenIds[i]);
        transferredTokenIds[i] = tokenIds[i];
    }
    
    // Emit bulk event
    emit BulkSalesTransfer(address(this), to, transferredTokenIds, salesMechanic);
}
    /**
     * @notice Update the work cycle (days of work before rest)
     * @dev Can only be called by Abraham
     * @dev Set to 0 for infinite work mode (no rest days required)
     * @dev If currently needing rest and switching to infinite mode, clears rest requirement
     * @param _daysOfWork New work cycle (0 = infinite)
     */
    function updateWorkCycle(uint256 _daysOfWork) external onlyAbraham {
        uint256 previousCycle = daysOfWork;
        daysOfWork = _daysOfWork;

        // If switching to infinite mode (0), clear any rest requirements
        if (_daysOfWork == 0) {
            worksSinceLastRest = 0;
            needsRest = false;
        }

        emit WorkCycleUpdated(previousCycle, _daysOfWork);
    }

    /**
     * @notice Update Abraham's address
     * @dev Can only be called by owner (deployer)
     * @dev Critical for key rotation and recovery over 13-year covenant
     * @dev New address immediately gains control of daily work commitments
     * @param _newAbraham New Abraham address
     */
    function updateAbrahamAddress(address _newAbraham) external onlyOwner {
        if (_newAbraham == address(0)) revert InvalidRecipient();

        address previousAbraham = abraham;
        abraham = _newAbraham;

        emit AbrahamAddressUpdated(previousAbraham, _newAbraham);
    }

    // ============ External View Functions ============

    /**
     * @notice Get the current total supply of minted tokens
     * @dev This represents minted tokens, not burned tokens (mint counter)
     * @return The number of tokens currently minted
     */
    function totalSupply() external view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @notice Get the next token ID that will be minted
     * @return The next token ID
     */
    function nextTokenId() external view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @notice Get current day number (days since covenant start)
     * @return Current day number (0 if covenant not started or not yet reached)
     */
    function getCurrentDay() external view returns (uint256) {
        if (!_hasStarted()) return 0;
        return _timeSince(covenantStartTimestamp) / 1 days;
    }

    /**
     * @notice Check if Abraham has committed work today
     * @return True if Abraham has already committed today
     */
    function hasCommittedToday() external view returns (bool) {
        if (!_hasStarted()) return false;
        return lastCommitDay == (_timeSince(covenantStartTimestamp) / 1 days);
    }

    /**
     * @notice Get daily work by day number
     * @param dayNumber Day number to query
     * @return work The daily work struct
     */
    function getDailyWork(uint256 dayNumber) external view returns (DailyWork memory work) {
        return _dailyWorks[dayNumber];
    }

    /**
     * @notice Check if the maximum supply has been reached
     * @return True if max supply reached, false otherwise
     */
    function isMaxSupplyReached() external view returns (bool) {
        return _tokenIdCounter >= maxSupply;
    }

    /**
     * @notice Get remaining tokens that can be minted
     * @return Number of tokens that can still be minted
     */
    function remainingSupply() external view returns (uint256) {
        uint256 currentSupply = _tokenIdCounter;
        return currentSupply >= maxSupply ? 0 : maxSupply - currentSupply;
    }

    // ============ Public View Functions ============

    /**
     * @notice Get the token URI for a specific token
     * @dev Each token has a unique IPFS URI set when committed
     * @param tokenId The token ID to get the URI for
     * @return The IPFS URI for this token's metadata
     */
    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        _requireOwned(tokenId);
        return _tokenURIs[tokenId];
    }

    /**
     * @notice Check if this contract supports a given interface
     * @dev Includes support for IERC721Receiver (via ERC721Holder) for covenant pattern
     * @param interfaceId The interface identifier to check
     * @return True if this contract supports the interface
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC721) returns (bool) {
        return
            interfaceId == type(IERC721Receiver).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // ============ Breach Checking View Functions ============

    /**
     * @notice Check if the covenant is currently active
     * @dev Returns false if covenant not started OR start time not yet reached
     * @return True if covenant is active, false if broken or grace period expired
     */
    function isCovenantActive() public view returns (bool) {
        // If covenant not started or start time not reached, return false
        if (!_hasStarted()) return false;

        // If already broken, return false
        if (covenantBroken) return false;

        // Calculate time since last commit
        uint256 timeSinceLastCommit;
        if (lastCommitTimestamp == 0) {
            // No commits yet - check time since covenant start
            timeSinceLastCommit = _timeSince(covenantStartTimestamp);
        } else {
            timeSinceLastCommit = _timeSince(lastCommitTimestamp);
        }

        return timeSinceLastCommit < GRACE_PERIOD;
    }

    /**
     * @notice Get days remaining until covenant breach
     * @dev Returns type(uint256).max if not started or start time not reached
     * @return Number of days remaining, 0 if already breached
     */
    function daysUntilBreach() public view returns (uint256) {
        // If covenant not started or start time not reached, return max value
        if (!_hasStarted()) return type(uint256).max;

        // If already broken, return 0
        if (covenantBroken) return 0;

        // Calculate time since last commit
        uint256 timeSinceLastCommit;
        if (lastCommitTimestamp == 0) {
            timeSinceLastCommit = _timeSince(covenantStartTimestamp);
        } else {
            timeSinceLastCommit = _timeSince(lastCommitTimestamp);
        }

        // If already expired, return 0
        if (timeSinceLastCommit >= GRACE_PERIOD) return 0;

        return (GRACE_PERIOD - timeSinceLastCommit) / 1 days;
    }

    /**
     * @notice Get hours remaining until covenant breach
     * @dev Returns type(uint256).max if not started or start time not reached
     * @return Number of hours remaining, 0 if already breached
     */
    function hoursUntilBreach() public view returns (uint256) {
        // If covenant not started or start time not reached, return max value
        if (!_hasStarted()) return type(uint256).max;

        // If already broken, return 0
        if (covenantBroken) return 0;

        // Calculate time since last commit
        uint256 timeSinceLastCommit;
        if (lastCommitTimestamp == 0) {
            timeSinceLastCommit = _timeSince(covenantStartTimestamp);
        } else {
            timeSinceLastCommit = _timeSince(lastCommitTimestamp);
        }

        // If already expired, return 0
        if (timeSinceLastCommit >= GRACE_PERIOD) return 0;

        return (GRACE_PERIOD - timeSinceLastCommit) / 1 hours;
    }

    /**
     * @notice Check if covenant has been breached and update state
     * @dev Can be called by anyone to trigger breach detection
     * @return True if covenant is broken, false if still active
     */
    function checkCovenantBreach() external returns (bool) {
        // If covenant not started or start time not reached, return false
        if (!_hasStarted()) return false;

        // If already broken, return true
        if (covenantBroken) return true;

        // Calculate time since last commit
        uint256 timeSinceLastCommit;
        if (lastCommitTimestamp == 0) {
            timeSinceLastCommit = _timeSince(covenantStartTimestamp);
        } else {
            timeSinceLastCommit = _timeSince(lastCommitTimestamp);
        }

        // Check if grace period has expired
        if (timeSinceLastCommit >= GRACE_PERIOD) {
            covenantBroken = true;
            emit CovenantBreached(block.timestamp, lastCommitTimestamp);
            return true;
        }

        return false;
    }

    // ============ Rescue Functions ============

    /**
     * @notice Rescue ERC721 tokens sent to this contract
     * @dev Can only be called by owner (deployer)
     * @param c Token contract address
     * @param id Token ID to rescue
     * @param to Address to send the token to
     */
    function rescueERC721(address c, uint256 id, address to) external onlyOwner {
        IERC721(c).safeTransferFrom(address(this), to, id);
    }

    /**
     * @notice Rescue ERC20 tokens sent to this contract
     * @dev Can only be called by owner (deployer)
     * @param t Token contract address
     * @param to Address to send the tokens to
     * @param amt Amount of tokens to rescue
     */
    function rescueERC20(address t, address to, uint256 amt) external onlyOwner {
        IERC20(t).transfer(to, amt);
    }

    /**
     * @notice Rescue ETH sent to this contract
     * @dev Can only be called by owner (deployer)
     * @param to Address to send the ETH to
     */
    function rescueETH(address payable to) external onlyOwner {
        to.transfer(address(this).balance);
    }
}
