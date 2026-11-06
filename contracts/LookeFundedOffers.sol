// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";

/**
 * M8 fully collateralised buyer-offer escrow. LOCAL ENGINEERING ONLY.
 * No deposit, NFT transfer or UOS payment is enabled in the application by default.
 * Not independently audited; do not deploy without operator authorisation.
 *
 * Deposits are exact, wallet-authorised, irrevocably reserved for ONE signed
 * buyer nonce and order hash. A seller must separately accept and approve NFTs.
 * Buyers can cancel and reclaim funds; third parties can refund expired orders.
 * No admin recovery, variable fee, cross-chain action or partial fill.
 */
contract LookeFundedOffers is EIP712, ReentrancyGuard {
    uint256 public constant ULTRA_TESTNET_CHAIN_ID = 18881;
    uint256 public constant VERSION = 1;
    uint256 public constant MAX_OFFER_WEI = 1000 ether;
    uint256 public constant MAX_ERC1155_QUANTITY = 1000;
    uint256 public constant MAX_LIFETIME = 90 days;
    uint16 public constant FEE_BPS = 200;
    uint16 public constant MAX_ROYALTY_BPS = 1000;

    bytes32 public constant OFFER_TYPEHASH = keccak256(
        "Offer(address buyer,address collection,uint256 tokenId,uint256 quantity,uint256 totalPriceWei,uint256 nonce,uint256 deadline,address allowedSeller,uint256 minSellerProceedsWei,uint16 maxFeeBps,uint16 maxRoyaltyBps,uint8 standard)"
    );

    struct Offer {
        address buyer;
        address collection;
        uint256 tokenId;
        uint256 quantity;
        uint256 totalPriceWei;
        uint256 nonce;
        uint256 deadline;
        address allowedSeller;
        uint256 minSellerProceedsWei;
        uint16 maxFeeBps;
        uint16 maxRoyaltyBps;
        uint8 standard;
    }

    // 0=absent, 1=exact UOS secured, 2=accepted, 3=refunded.
    mapping(bytes32 => uint8) public offerState;
    mapping(address => mapping(uint256 => bytes32)) public fundedNonceHash;
    mapping(address => mapping(uint256 => bool)) public invalidNonces;
    mapping(address => uint256) public minimumNonce;
    mapping(address => uint256) public buyerLockedWei;
    uint256 public totalLockedWei;

    address payable public immutable feeRecipient;

    error WrongChain();
    error InvalidRecipient();
    error BadOffer();
    error OfferExpired();
    error InvalidNonce();
    error BadSignature();
    error IncorrectFunding();
    error NotFunded();
    error NotBuyer();
    error NotSeller();
    error UnapprovedNFT();
    error RoyaltyExceedsBound();
    error SellerProceedsTooLow();
    error NativeTransferFailed();
    error Insolvent();

    event OfferFunded(
        bytes32 indexed offerHash, address indexed buyer,
        address indexed collection, uint256 tokenId, uint256 quantity,
        uint256 totalPriceWei, uint256 nonce, uint256 deadline
    );
    event OfferRefunded(
        bytes32 indexed offerHash, address indexed buyer,
        address indexed recipient, uint256 amountWei, uint256 nonce
    );
    event OfferAccepted(
        bytes32 indexed offerHash, address indexed buyer,
        address indexed seller, address collection, uint256 tokenId,
        uint256 quantity, uint256 totalPriceWei, uint256 feeWei,
        address royaltyRecipient, uint256 royaltyWei,
        uint256 sellerProceedsWei, uint256 nonce, uint8 standard
    );
    event OfferNonceCancelled(address indexed buyer, uint256 indexed nonce);
    event MinimumOfferNonceIncreased(address indexed buyer, uint256 previous, uint256 current);

    constructor(address payable treasury) EIP712("LookeNFT FundedOffer", "1") {
        if (block.chainid != ULTRA_TESTNET_CHAIN_ID) revert WrongChain();
        if (treasury == address(0)) revert InvalidRecipient();
        feeRecipient = treasury;
    }

    function offerHash(Offer calldata o) public view returns (bytes32) {
        bytes32 structure = keccak256(abi.encode(
            OFFER_TYPEHASH, o.buyer, o.collection, o.tokenId, o.quantity,
            o.totalPriceWei, o.nonce, o.deadline, o.allowedSeller,
            o.minSellerProceedsWei, o.maxFeeBps, o.maxRoyaltyBps, o.standard
        ));
        return _hashTypedDataV4(structure);
    }

    function _validate(Offer calldata o) internal view {
        if (block.chainid != ULTRA_TESTNET_CHAIN_ID) revert WrongChain();
        if (o.buyer == address(0) || o.collection.code.length == 0 ||
            o.quantity == 0 || o.totalPriceWei == 0 ||
            o.totalPriceWei > MAX_OFFER_WEI ||
            (o.standard != 1 && o.standard != 2) ||
            (o.standard == 1 && o.quantity != 1) ||
            (o.standard == 2 && o.quantity > MAX_ERC1155_QUANTITY) ||
            o.maxFeeBps < FEE_BPS || o.maxRoyaltyBps > MAX_ROYALTY_BPS ||
            o.minSellerProceedsWei > o.totalPriceWei) revert BadOffer();
        if (o.deadline < block.timestamp || o.deadline > block.timestamp + MAX_LIFETIME)
            revert OfferExpired();
        if (o.nonce < minimumNonce[o.buyer] || invalidNonces[o.buyer][o.nonce])
            revert InvalidNonce();
        if (!IERC165(o.collection).supportsInterface(
            o.standard == 1 ? type(IERC721).interfaceId : type(IERC1155).interfaceId
        )) revert BadOffer();
    }

    function fund(Offer calldata o, bytes calldata signature) external payable nonReentrant {
        _validate(o);
        if (msg.sender != o.buyer) revert NotBuyer();
        if (msg.value != o.totalPriceWei) revert IncorrectFunding();
        bytes32 digest = offerHash(o);
        if (offerState[digest] != 0 || fundedNonceHash[o.buyer][o.nonce] != bytes32(0))
            revert InvalidNonce();
        if (!SignatureChecker.isValidSignatureNow(o.buyer, digest, signature))
            revert BadSignature();
        fundedNonceHash[o.buyer][o.nonce] = digest;
        offerState[digest] = 1;
        buyerLockedWei[o.buyer] += msg.value;
        totalLockedWei += msg.value;
        _assertSolvent();
        emit OfferFunded(
            digest, o.buyer, o.collection, o.tokenId, o.quantity,
            msg.value, o.nonce, o.deadline
        );
    }

    function cancelNonce(uint256 nonce) external {
        if (nonce < minimumNonce[msg.sender] || invalidNonces[msg.sender][nonce]) revert InvalidNonce();
        invalidNonces[msg.sender][nonce] = true;
        emit OfferNonceCancelled(msg.sender, nonce);
        // A funded offer is reclaimable by refundTo or refundExpired.
    }

    function raiseMinimumNonce(uint256 newMinimum) external {
        uint256 previous = minimumNonce[msg.sender];
        if (newMinimum <= previous || newMinimum == type(uint256).max) revert InvalidNonce();
        minimumNonce[msg.sender] = newMinimum;
        emit MinimumOfferNonceIncreased(msg.sender, previous, newMinimum);
        // Funded lower nonces stay safely escrowed until refunded (not swept).
    }

    /**
     * Authenticated buyer refund. Buyer may choose another recipient, avoiding
     * irretrievable escrow if a contract wallet itself cannot receive UOS.
     */
    function refundTo(Offer calldata o, address payable recipient) external nonReentrant {
        if (msg.sender != o.buyer) revert NotBuyer();
        if (recipient == address(0)) revert InvalidRecipient();
        _refund(o, recipient);
    }

    /** Anyone can trigger return to the original buyer after expiry/cancellation. */
    function refundExpired(Offer calldata o) external nonReentrant {
        if (block.timestamp <= o.deadline && !invalidNonces[o.buyer][o.nonce] &&
            o.nonce >= minimumNonce[o.buyer]) revert OfferExpired();
        _refund(o, payable(o.buyer));
    }

    function _refund(Offer calldata o, address payable recipient) internal {
        bytes32 digest = offerHash(o);
        if (offerState[digest] != 1 || fundedNonceHash[o.buyer][o.nonce] != digest)
            revert NotFunded();
        offerState[digest] = 3;
        invalidNonces[o.buyer][o.nonce] = true;
        buyerLockedWei[o.buyer] -= o.totalPriceWei;
        totalLockedWei -= o.totalPriceWei;
        _pay(recipient, o.totalPriceWei);
        _assertSolvent();
        emit OfferRefunded(digest, o.buyer, recipient, o.totalPriceWei, o.nonce);
    }

    function _quote(Offer calldata o)
        internal view returns (uint256 fee, address receiver, uint256 royalty, uint256 proceeds)
    {
        fee = o.totalPriceWei * FEE_BPS / 10000;
        if (IERC165(o.collection).supportsInterface(type(IERC2981).interfaceId))
            (receiver, royalty) = IERC2981(o.collection).royaltyInfo(o.tokenId, o.totalPriceWei);
        if (royalty > o.totalPriceWei * o.maxRoyaltyBps / 10000 ||
            royalty > o.totalPriceWei * MAX_ROYALTY_BPS / 10000 ||
            (royalty != 0 && receiver == address(0)) ||
            fee + royalty > o.totalPriceWei) revert RoyaltyExceedsBound();
        proceeds = o.totalPriceWei - fee - royalty;
        if (proceeds < o.minSellerProceedsWei) revert SellerProceedsTooLow();
    }

    function quote(Offer calldata o)
        external view returns (uint256 fee, address receiver, uint256 royalty, uint256 proceeds)
    {
        _validate(o);
        return _quote(o);
    }

    function _approvedSeller(Offer calldata o, address seller) internal view {
        if (seller == o.buyer || (o.allowedSeller != address(0) && o.allowedSeller != seller))
            revert NotSeller();
        if (o.standard == 1) {
            IERC721 token = IERC721(o.collection);
            if (token.ownerOf(o.tokenId) != seller ||
                (token.getApproved(o.tokenId) != address(this) &&
                 !token.isApprovedForAll(seller, address(this)))) revert UnapprovedNFT();
        } else {
            IERC1155 token = IERC1155(o.collection);
            if (token.balanceOf(seller, o.tokenId) < o.quantity ||
                !token.isApprovedForAll(seller, address(this))) revert UnapprovedNFT();
        }
    }

    function accept(Offer calldata o) external nonReentrant {
        _validate(o);
        bytes32 digest = offerHash(o);
        if (offerState[digest] != 1 || fundedNonceHash[o.buyer][o.nonce] != digest)
            revert NotFunded();
        _approvedSeller(o, msg.sender);
        (uint256 fee, address receiver, uint256 royalty, uint256 proceeds) = _quote(o);

        // Update ALL accounting before token callbacks and native payouts.
        offerState[digest] = 2;
        invalidNonces[o.buyer][o.nonce] = true;
        buyerLockedWei[o.buyer] -= o.totalPriceWei;
        totalLockedWei -= o.totalPriceWei;

        if (o.standard == 1) {
            IERC721(o.collection).safeTransferFrom(msg.sender, o.buyer, o.tokenId);
        } else {
            IERC1155(o.collection).safeTransferFrom(msg.sender, o.buyer, o.tokenId, o.quantity, "");
        }
        _pay(payable(msg.sender), proceeds);
        if (fee != 0) _pay(feeRecipient, fee);
        if (royalty != 0) _pay(payable(receiver), royalty);
        _assertSolvent();
        emit OfferAccepted(
            digest, o.buyer, msg.sender, o.collection, o.tokenId,
            o.quantity, o.totalPriceWei, fee, receiver, royalty,
            proceeds, o.nonce, o.standard
        );
    }

    function _pay(address payable recipient, uint256 value) internal {
        (bool ok,) = recipient.call{value:value}("");
        if (!ok) revert NativeTransferFailed();
    }

    function _assertSolvent() internal view {
        if (address(this).balance < totalLockedWei) revert Insolvent();
    }

    // No receive/fallback, sweep, admin withdrawal or unbounded escrow.
}
