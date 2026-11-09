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
 * M7 local-only contract groundwork. Not independently audited or deployed.
 * Atomic non-custodial fixed-price ERC721 and ERC1155 full-order settlement.
 * Signed order = EIP712 domain-bound to chain 18881 and this contract.
 * No operator role, upgradability, unrestricted fee change or escrow.
 */
contract LookeFixedPriceMarket is EIP712, ReentrancyGuard {
    uint256 public constant ULTRA_TESTNET_CHAIN_ID = 18881;
    uint256 public constant VERSION = 1;
    uint256 public constant MAX_UOS_PRICE_WEI = 1000 ether;
    uint256 public constant MAX_ERC1155_QUANTITY = 1000;
    uint16 public constant FEE_BPS = 200; // transparent fixed 2% marketplace fee
    uint16 public constant MAX_ROYALTY_BPS = 1000; // seller-authorised maximum 10%
    uint256 public constant MAX_ORDER_LIFETIME = 90 days;

    bytes32 public constant LISTING_TYPEHASH = keccak256(
        "Listing(address seller,address collection,uint256 tokenId,uint256 quantity,uint256 unitPriceWei,uint256 nonce,uint256 deadline,address reservedBuyer,uint256 minSellerProceedsWei,uint16 maxFeeBps,uint16 maxRoyaltyBps,uint8 standard)"
    );

    address payable public immutable feeRecipient;

    struct Listing {
        address seller;
        address collection;
        uint256 tokenId;
        uint256 quantity;
        uint256 unitPriceWei;
        uint256 nonce;
        uint256 deadline;
        address reservedBuyer; // zero is public
        uint256 minSellerProceedsWei;
        uint16 maxFeeBps;
        uint16 maxRoyaltyBps;
        uint8 standard; // 1=ERC721, 2=ERC1155
    }

    mapping(address => mapping(uint256 => bool)) public invalidNonces;
    mapping(address => uint256) public minimumNonce;

    error WrongChain();
    error InvalidListing();
    error ListingExpired();
    error InvalidSignature();
    error InvalidNonce();
    error UnauthorizedCancellation();
    error UnauthorizedBuyer();
    error InvalidPrice();
    error UnauthorizedNFT();
    error RoyaltyExceedsBound();
    error SellerProceedsTooLow();
    error TransferFailed();
    error InvalidRecipient();

    event NonceCancelled(address indexed seller, uint256 indexed nonce);
    event MinimumNonceIncreased(address indexed seller, uint256 previous, uint256 current);
    event ListingFilled(
        bytes32 indexed orderHash,
        address indexed seller,
        address indexed buyer,
        address collection,
        uint256 tokenId,
        uint256 quantity,
        uint256 priceWei,
        uint256 feeWei,
        address royaltyRecipient,
        uint256 royaltyWei,
        uint256 sellerProceedsWei,
        uint256 nonce,
        uint8 standard
    );

    constructor(address payable recipient) EIP712("LookeNFT FixedPrice", "1") {
        if (block.chainid != ULTRA_TESTNET_CHAIN_ID) revert WrongChain();
        if (recipient == address(0)) revert InvalidRecipient();
        feeRecipient = recipient;
    }

    function _structHash(Listing calldata o) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            LISTING_TYPEHASH, o.seller, o.collection, o.tokenId, o.quantity,
            o.unitPriceWei, o.nonce, o.deadline, o.reservedBuyer,
            o.minSellerProceedsWei, o.maxFeeBps, o.maxRoyaltyBps, o.standard
        ));
    }

    function hashListing(Listing calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(_structHash(o));
    }

    function cancelNonce(uint256 nonce) external {
        if (nonce < minimumNonce[msg.sender] || invalidNonces[msg.sender][nonce]) revert InvalidNonce();
        invalidNonces[msg.sender][nonce] = true;
        emit NonceCancelled(msg.sender, nonce);
    }

    function raiseMinimumNonce(uint256 newMinimum) external {
        uint256 previous = minimumNonce[msg.sender];
        if (newMinimum <= previous || newMinimum == type(uint256).max) revert InvalidNonce();
        minimumNonce[msg.sender] = newMinimum;
        emit MinimumNonceIncreased(msg.sender, previous, newMinimum);
    }

    function _terms(Listing calldata o) internal view returns (uint256 price) {
        if (block.chainid != ULTRA_TESTNET_CHAIN_ID) revert WrongChain();
        if (o.seller == address(0) || o.collection.code.length == 0 ||
            o.quantity == 0 || o.unitPriceWei == 0 ||
            (o.standard != 1 && o.standard != 2) ||
            (o.standard == 1 && o.quantity != 1) ||
            (o.standard == 2 && o.quantity > MAX_ERC1155_QUANTITY) ||
            o.maxFeeBps < FEE_BPS || o.maxRoyaltyBps > MAX_ROYALTY_BPS)
            revert InvalidListing();
        if (o.deadline < block.timestamp || o.deadline > block.timestamp + MAX_ORDER_LIFETIME)
            revert ListingExpired();
        if (o.nonce < minimumNonce[o.seller] || invalidNonces[o.seller][o.nonce])
            revert InvalidNonce();
        price = o.unitPriceWei * o.quantity;
        if (price > MAX_UOS_PRICE_WEI) revert InvalidPrice();
        if (!IERC165(o.collection).supportsInterface(
            o.standard == 1 ? type(IERC721).interfaceId : type(IERC1155).interfaceId
        )) revert InvalidListing();
    }

    function _quote(Listing calldata o, uint256 price)
        internal view returns (uint256 fee, address receiver, uint256 royalty, uint256 proceeds)
    {
        fee = price * FEE_BPS / 10_000;
        if (IERC165(o.collection).supportsInterface(type(IERC2981).interfaceId)) {
            (receiver, royalty) = IERC2981(o.collection).royaltyInfo(o.tokenId, price);
        }
        if (royalty > price * o.maxRoyaltyBps / 10_000 ||
            royalty > price * MAX_ROYALTY_BPS / 10_000 ||
            (royalty != 0 && receiver == address(0)) || fee + royalty > price)
            revert RoyaltyExceedsBound();
        proceeds = price - fee - royalty;
        if (proceeds < o.minSellerProceedsWei) revert SellerProceedsTooLow();
    }

    function quote(Listing calldata o)
        external view returns (uint256 price, uint256 fee, address receiver, uint256 royalty, uint256 proceeds)
    {
        price = _terms(o);
        (fee, receiver, royalty, proceeds) = _quote(o, price);
    }

    function _requireOwnedAndApproved(Listing calldata o) internal view {
        if (o.standard == 1) {
            IERC721 nft = IERC721(o.collection);
            if (nft.ownerOf(o.tokenId) != o.seller ||
                (nft.getApproved(o.tokenId) != address(this) &&
                 !nft.isApprovedForAll(o.seller, address(this)))) revert UnauthorizedNFT();
        } else {
            IERC1155 nft = IERC1155(o.collection);
            if (nft.balanceOf(o.seller, o.tokenId) < o.quantity ||
                !nft.isApprovedForAll(o.seller, address(this))) revert UnauthorizedNFT();
        }
    }

    function isFillable(Listing calldata o, bytes calldata signature)
        external view returns (bool)
    {
        // Return false rather than claiming that an order is currently executable
        // if signature, deadline, nonce, approval or token ownership is invalid.
        if (o.seller == address(0)) return false;
        if (!SignatureChecker.isValidSignatureNow(o.seller, hashListing(o), signature)) return false;
        try this.quote(o) returns (uint256, uint256, address, uint256, uint256) {
            if (o.standard == 1) {
                IERC721 token = IERC721(o.collection);
                return token.ownerOf(o.tokenId) == o.seller &&
                    (token.getApproved(o.tokenId) == address(this) ||
                     token.isApprovedForAll(o.seller, address(this)));
            }
            if (o.standard == 2) {
                IERC1155 token = IERC1155(o.collection);
                return token.balanceOf(o.seller, o.tokenId) >= o.quantity &&
                    token.isApprovedForAll(o.seller, address(this));
            }
        } catch { return false; }
        return false;
    }

    function buy(Listing calldata o, bytes calldata signature) external payable nonReentrant {
        uint256 price = _terms(o);
        if (msg.sender == o.seller) revert UnauthorizedBuyer(); // no self-trading
        if (o.reservedBuyer != address(0) && o.reservedBuyer != msg.sender)
            revert UnauthorizedBuyer();
        if (msg.value != price) revert InvalidPrice();
        bytes32 digest = hashListing(o);
        if (!SignatureChecker.isValidSignatureNow(o.seller, digest, signature))
            revert InvalidSignature();

        _requireOwnedAndApproved(o);
        (uint256 fee, address receiver, uint256 royalty, uint256 proceeds) = _quote(o, price);

        // Effect BEFORE any ERC721/ERC1155 receiver callbacks or native payouts.
        invalidNonces[o.seller][o.nonce] = true;

        if (o.standard == 1) {
            IERC721(o.collection).safeTransferFrom(o.seller, msg.sender, o.tokenId);
        } else {
            IERC1155(o.collection).safeTransferFrom(o.seller, msg.sender, o.tokenId, o.quantity, "");
        }

        // Entire transaction reverts including NFT transfer and nonce on any failed payout.
        _pay(payable(o.seller), proceeds);
        if (fee != 0) _pay(feeRecipient, fee);
        if (royalty != 0) _pay(payable(receiver), royalty);

        emit ListingFilled(
            digest, o.seller, msg.sender, o.collection, o.tokenId,
            o.quantity, price, fee, receiver, royalty, proceeds, o.nonce, o.standard
        );
    }

    function _pay(address payable to, uint256 value) internal {
        (bool success,) = to.call{value: value}("");
        if (!success) revert TransferFailed();
    }
}
