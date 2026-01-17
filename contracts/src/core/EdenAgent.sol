// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "../interfaces/IGatingModule.sol";

/**
 * @title EdenAgent
 * @notice Core contract for AI agent content curation on-chain
 * @dev Implements session submission, reactions, messages, winner selection, and ERC1155 NFTs.
 *      Content is stored off-chain (IPFS), only hashes are on-chain.
 */
contract EdenAgent is AccessControl, ReentrancyGuard, ERC1155, ERC1155Supply {
    // ============ Roles ============
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");

    // ============ Structs ============
    struct Session {
        uint256 id;
        address creator;
        string contentHash;
        uint256 reactionCount;
        uint256 reactionScore;
        uint256 messageCount;
        uint256 createdAt;
        uint256 submittedInPeriod;
        uint256 selectedInPeriod;
        bool isRetracted;
    }

    struct MessageRef {
        uint256 id;
        uint256 sessionId;
        address sender;
        string contentHash;
        uint256 createdAt;
    }

    struct Config {
        uint256 periodDuration;
        uint256 reactionsPerToken;
        uint256 messagesPerToken;
        uint256 editionPrice;
    }

    struct EditionAlloc {
        uint256 creatorAmount;
        uint256 curatorAmount;
        uint256 publicAmount;
    }

    // ============ State ============
    Config public config;
    IGatingModule public gatingModule;
    address public treasury;
    bool public paused;

    mapping(uint256 => Session) public sessions;
    uint256 public sessionCount;
    uint256 public currentPeriod;
    uint256 public currentPeriodStart;

    mapping(uint256 => uint256[]) public periodSessionIds;
    uint256[] public eligibleSessionIds;
    mapping(uint256 => uint256) internal eligibleSessionIndex;
    mapping(uint256 => bool) internal isEligible;
    mapping(uint256 => uint256) public periodWinners;

    mapping(address => mapping(uint256 => uint256)) public userSessionReactions;
    mapping(address => mapping(uint256 => uint256)) public userDailyReactions;
    uint256 public totalReactions;

    mapping(uint256 => MessageRef) public messages;
    mapping(uint256 => uint256[]) public sessionMessageIds;
    mapping(address => mapping(uint256 => uint256)) public userDailyMessages;
    uint256 public messageCount;

    mapping(address => mapping(address => bool)) public delegateApprovals;

    mapping(uint256 => uint256) public sessionToTokenId;
    mapping(uint256 => uint256) public tokenIdToSessionId;
    mapping(uint256 => uint256) public editionsSold;
    mapping(uint256 => uint256) public curatorEditionsDistributed;
    uint256 public nextTokenId;

    EditionAlloc public editionAlloc;

    uint256 internal constant SCORE_SCALE = 1e6;

    // ============ Events ============
    event SessionSubmitted(uint256 indexed sessionId, address indexed creator, string contentHash, uint256 period);
    event SessionRetracted(uint256 indexed sessionId, address indexed creator);
    event ReactionSubmitted(uint256 indexed sessionId, address indexed reactor, uint256 newScore);
    event MessageSubmitted(uint256 indexed messageId, uint256 indexed sessionId, address indexed sender, string contentHash);
    event SessionSelected(uint256 indexed period, uint256 indexed sessionId, uint256 score);
    event EditionMinted(uint256 indexed sessionId, uint256 indexed tokenId, uint256 supply);
    event EditionPurchased(uint256 indexed tokenId, address indexed buyer, uint256 amount, uint256 price);
    event CuratorEditionsDistributed(uint256 indexed tokenId, address[] curators, uint256[] amounts);
    event PeriodStarted(uint256 indexed period);
    event DelegateApproval(address indexed user, address indexed delegate, bool approved);

    // ============ Errors ============
    error Paused();
    error InvalidContentHash();
    error SessionNotFound();
    error SessionAlreadySelected();
    error SessionIsRetracted();
    error NotSessionCreator();
    error AlreadyRetracted();
    error InvalidGatingProof();
    error NoTokens();
    error DailyLimitReached();
    error PeriodNotEnded();
    error NoValidSession();
    error NotAuthorized();
    error InvalidPayment();
    error EditionNotAvailable();
    error MaxSessionsReached();
    error CuratorLimitExceeded();
    error ArrayLengthMismatch();

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor(
        address admin,
        address _treasury,
        address _gatingModule,
        string memory baseURI
    ) ERC1155(baseURI) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        treasury = _treasury;
        if (_gatingModule != address(0)) gatingModule = IGatingModule(_gatingModule);

        config = Config({
            periodDuration: 1 days,
            reactionsPerToken: 1,
            messagesPerToken: 1,
            editionPrice: 0
        });

        editionAlloc = EditionAlloc({
            creatorAmount: 1,
            curatorAmount: 0,
            publicAmount: 0
        });

        currentPeriod = 1;
        currentPeriodStart = block.timestamp;
        nextTokenId = 1;
        emit PeriodStarted(1);
    }

    // ============ Session Functions ============
    function submitSession(string calldata contentHash) external whenNotPaused onlyRole(CREATOR_ROLE) returns (uint256) {
        _validateContentHash(contentHash);
        uint256 sessionId = sessionCount++;

        sessions[sessionId] = Session({
            id: sessionId,
            creator: msg.sender,
            contentHash: contentHash,
            reactionCount: 0,
            reactionScore: 0,
            messageCount: 0,
            createdAt: block.timestamp,
            submittedInPeriod: currentPeriod,
            selectedInPeriod: 0,
            isRetracted: false
        });

        periodSessionIds[currentPeriod].push(sessionId);
        eligibleSessionIds.push(sessionId);
        eligibleSessionIndex[sessionId] = eligibleSessionIds.length - 1;
        isEligible[sessionId] = true;

        emit SessionSubmitted(sessionId, msg.sender, contentHash, currentPeriod);
        return sessionId;
    }

    function retractSession(uint256 sessionId) external {
        Session storage s = sessions[sessionId];
        if (s.createdAt == 0) revert SessionNotFound();
        if (s.creator != msg.sender) revert NotSessionCreator();
        if (s.selectedInPeriod > 0) revert SessionAlreadySelected();
        if (s.isRetracted) revert AlreadyRetracted();

        s.isRetracted = true;
        _removeFromEligible(sessionId);
        emit SessionRetracted(sessionId, msg.sender);
    }

    // ============ Reaction Functions ============
    function react(uint256 sessionId, uint256[] calldata tokenIds, bytes calldata proof) public payable whenNotPaused nonReentrant {
        _verifyGating(msg.sender, tokenIds, proof);
        _checkDailyReactionLimit(msg.sender, tokenIds.length);
        _processReaction(sessionId, msg.sender);
    }

    function reactFor(uint256 sessionId, address reactor, uint256[] calldata tokenIds, bytes calldata proof) public payable whenNotPaused nonReentrant {
        if (!delegateApprovals[reactor][msg.sender] && !hasRole(OPERATOR_ROLE, msg.sender)) revert NotAuthorized();
        _verifyGating(reactor, tokenIds, proof);
        _checkDailyReactionLimit(reactor, tokenIds.length);
        _processReaction(sessionId, reactor);
    }

    function _processReaction(uint256 sessionId, address reactor) internal {
        Session storage s = sessions[sessionId];
        if (s.createdAt == 0) revert SessionNotFound();
        if (s.selectedInPeriod > 0) revert SessionAlreadySelected();
        if (s.isRetracted) revert SessionIsRetracted();
        if (block.timestamp >= currentPeriodStart + config.periodDuration) revert PeriodNotEnded();

        uint256 prev = userSessionReactions[reactor][sessionId];
        userSessionReactions[reactor][sessionId] = prev + 1;
        s.reactionCount++;

        // Quadratic scoring with diminishing returns
        uint256 prevScore = prev > 0 ? _sqrt(prev * SCORE_SCALE) : 0;
        uint256 newScore = _sqrt((prev + 1) * SCORE_SCALE);
        s.reactionScore += (newScore - prevScore);
        totalReactions++;

        emit ReactionSubmitted(sessionId, reactor, s.reactionScore);
    }

    // ============ Message Functions ============
    function sendMessage(uint256 sessionId, string calldata contentHash, uint256[] calldata tokenIds, bytes calldata proof) public payable whenNotPaused nonReentrant {
        Session storage s = sessions[sessionId];
        if (s.createdAt == 0) revert SessionNotFound();
        _validateContentHash(contentHash);
        _verifyGating(msg.sender, tokenIds, proof);
        _checkDailyMessageLimit(msg.sender, tokenIds.length);

        uint256 messageId = messageCount++;
        messages[messageId] = MessageRef(messageId, sessionId, msg.sender, contentHash, block.timestamp);
        sessionMessageIds[sessionId].push(messageId);
        s.messageCount++;

        emit MessageSubmitted(messageId, sessionId, msg.sender, contentHash);
    }

    // ============ Selection Functions ============
    function selectSession() public whenNotPaused nonReentrant returns (uint256) {
        if (block.timestamp < currentPeriodStart + config.periodDuration) revert PeriodNotEnded();

        uint256[] memory candidates = periodSessionIds[currentPeriod];
        uint256 winnerId;
        uint256 maxScore;

        for (uint256 i = 0; i < candidates.length; i++) {
            Session storage s = sessions[candidates[i]];
            if (!s.isRetracted && s.selectedInPeriod == 0 && s.reactionScore > maxScore) {
                maxScore = s.reactionScore;
                winnerId = candidates[i];
            }
        }

        if (maxScore == 0) revert NoValidSession();

        Session storage winner = sessions[winnerId];
        winner.selectedInPeriod = currentPeriod;
        periodWinners[currentPeriod] = winnerId;

        // Mint editions with allocation
        uint256 tokenId = nextTokenId++;
        uint256 totalSupply = editionAlloc.creatorAmount + editionAlloc.curatorAmount + editionAlloc.publicAmount;
        if (totalSupply == 0) totalSupply = 1;

        sessionToTokenId[winnerId] = tokenId;
        tokenIdToSessionId[tokenId] = winnerId;

        // Mint creator editions directly to creator
        if (editionAlloc.creatorAmount > 0) {
            _mint(winner.creator, tokenId, editionAlloc.creatorAmount, "");
        }
        // Mint curator + public editions to contract
        uint256 contractEditions = editionAlloc.curatorAmount + editionAlloc.publicAmount;
        if (contractEditions > 0) {
            _mint(address(this), tokenId, contractEditions, "");
        }
        emit EditionMinted(winnerId, tokenId, totalSupply);

        _removeFromEligible(winnerId);
        emit SessionSelected(currentPeriod, winnerId, maxScore);

        currentPeriod++;
        currentPeriodStart = block.timestamp;
        emit PeriodStarted(currentPeriod);

        return winnerId;
    }

    function purchaseEdition(uint256 tokenId, uint256 amount) public payable nonReentrant {
        uint256 available = balanceOf(address(this), tokenId);
        if (amount > available) revert EditionNotAvailable();
        uint256 total = config.editionPrice * amount;
        if (msg.value < total) revert InvalidPayment();

        editionsSold[tokenId] += amount;
        _safeTransferFrom(address(this), msg.sender, tokenId, amount, "");

        if (total > 0) {
            uint256 sessionId = tokenIdToSessionId[tokenId];
            address creator = sessions[sessionId].creator;
            uint256 creatorShare = total / 2;
            payable(creator).transfer(creatorShare);
            payable(treasury).transfer(total - creatorShare);
        }

        if (msg.value > total) payable(msg.sender).transfer(msg.value - total);
        emit EditionPurchased(tokenId, msg.sender, amount, total);
    }

    /// @notice Distribute curator editions based on off-chain leaderboard (operator only)
    function distributeCuratorEditions(
        uint256 tokenId,
        address[] calldata curators,
        uint256[] calldata amounts
    ) public onlyRole(OPERATOR_ROLE) nonReentrant {
        if (curators.length != amounts.length) revert ArrayLengthMismatch();

        uint256 totalToDistribute;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalToDistribute += amounts[i];
        }

        // Check we don't exceed curator allocation
        if (curatorEditionsDistributed[tokenId] + totalToDistribute > editionAlloc.curatorAmount) {
            revert CuratorLimitExceeded();
        }

        // Check contract has enough
        if (totalToDistribute > balanceOf(address(this), tokenId)) {
            revert EditionNotAvailable();
        }

        curatorEditionsDistributed[tokenId] += totalToDistribute;

        // Distribute to each curator
        for (uint256 i = 0; i < curators.length; i++) {
            if (amounts[i] > 0) {
                _safeTransferFrom(address(this), curators[i], tokenId, amounts[i], "");
            }
        }

        emit CuratorEditionsDistributed(tokenId, curators, amounts);
    }

    // ============ Delegation ============
    function approveDelegate(address delegate, bool approved) external {
        delegateApprovals[msg.sender][delegate] = approved;
        emit DelegateApproval(msg.sender, delegate, approved);
    }

    // ============ View Functions ============
    function getSession(uint256 sessionId) external view returns (Session memory) {
        return sessions[sessionId];
    }

    function getTimeUntilPeriodEnd() external view returns (uint256) {
        uint256 end = currentPeriodStart + config.periodDuration;
        return block.timestamp >= end ? 0 : end - block.timestamp;
    }

    function getRemainingReactions(address user, uint256 tokenCount) external view returns (uint256) {
        uint256 max = tokenCount * config.reactionsPerToken;
        uint256 used = userDailyReactions[user][block.timestamp / 1 days];
        return used >= max ? 0 : max - used;
    }

    // ============ Admin Functions ============
    function setConfig(Config calldata newConfig) external onlyRole(DEFAULT_ADMIN_ROLE) {
        config = newConfig;
    }

    function setEditionAlloc(EditionAlloc calldata newAlloc) external onlyRole(DEFAULT_ADMIN_ROLE) {
        editionAlloc = newAlloc;
    }

    function setGatingModule(address module) external onlyRole(DEFAULT_ADMIN_ROLE) {
        gatingModule = IGatingModule(module);
    }

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = _treasury;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { paused = true; }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { paused = false; }

    function addCreator(address creator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(CREATOR_ROLE, creator);
    }

    function addOperator(address operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(OPERATOR_ROLE, operator);
    }

    // ============ Internal ============
    function _validateContentHash(string calldata hash) internal pure {
        bytes memory b = bytes(hash);
        if (b.length < 10 || b.length > 100) revert InvalidContentHash();
    }

    function _verifyGating(address user, uint256[] calldata tokenIds, bytes calldata proof) internal view {
        if (address(gatingModule) == address(0)) {
            if (tokenIds.length == 0) revert NoTokens();
            return;
        }
        IGatingModule.GatingResult memory result = gatingModule.verify(user, tokenIds, proof);
        if (!result.valid) revert InvalidGatingProof();
        if (result.tokenCount == 0) revert NoTokens();
    }

    function _checkDailyReactionLimit(address user, uint256 tokenCount) internal {
        uint256 day = block.timestamp / 1 days;
        uint256 max = tokenCount * config.reactionsPerToken;
        if (userDailyReactions[user][day] >= max) revert DailyLimitReached();
        userDailyReactions[user][day]++;
    }

    function _checkDailyMessageLimit(address user, uint256 tokenCount) internal {
        uint256 day = block.timestamp / 1 days;
        uint256 max = tokenCount * config.messagesPerToken;
        if (userDailyMessages[user][day] >= max) revert DailyLimitReached();
        userDailyMessages[user][day]++;
    }

    function _removeFromEligible(uint256 sessionId) internal {
        if (!isEligible[sessionId]) return;
        uint256 idx = eligibleSessionIndex[sessionId];
        uint256 lastIdx = eligibleSessionIds.length - 1;
        if (idx != lastIdx) {
            uint256 lastId = eligibleSessionIds[lastIdx];
            eligibleSessionIds[idx] = lastId;
            eligibleSessionIndex[lastId] = idx;
        }
        eligibleSessionIds.pop();
        delete eligibleSessionIndex[sessionId];
        isEligible[sessionId] = false;
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    // ============ ERC1155 Overrides ============
    function uri(uint256 tokenId) public view override returns (string memory) {
        return string(abi.encodePacked(super.uri(tokenId), sessions[tokenIdToSessionId[tokenId]].contentHash));
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override(ERC1155, ERC1155Supply) {
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
