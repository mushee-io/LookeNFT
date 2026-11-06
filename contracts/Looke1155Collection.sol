// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {LookeMintPhases} from "./LookeMintPhases.sol";

/**
 * @title Looke1155Collection
 * @notice Creator-owned, non-upgradeable ERC-1155 contract with *lifetime*
 *         global and per-token caps. Burning never restores mint allowance.
 * @dev M5: reserve and public/allowlist mints share lifetime caps.
 */
contract Looke1155Collection is ERC1155, ERC2981, LookeMintPhases {
    error InvalidCollectionConfiguration();
    error SupplyCapExceeded();
    error MetadataIsFrozen();

    uint256 public constant SUPPLY_HARD_LIMIT = 1_000_000;
    uint96 public constant ROYALTY_HARD_LIMIT = 1_000;

    uint256 public immutable maxTotalMinted;
    uint256 public immutable maxMintedPerId;
    uint256 public totalMinted;
    mapping(uint256 => uint256) public mintedById;
    bool public metadataFrozen;
    string private _collectionURI;

    event ReservedMint(address indexed to, uint256 indexed tokenId, uint256 quantity);
    event CollectionURIUpdated(string newURI);
    event MetadataFrozen();

    constructor(
        string memory uriTemplate_,
        uint256 totalCap_,
        uint256 perIdCap_,
        address creator_,
        address royaltyReceiver_,
        uint96 royaltyBps_
    ) ERC1155(uriTemplate_) LookeMintPhases(creator_) {
        if (
            bytes(uriTemplate_).length == 0 || bytes(uriTemplate_).length > 512 ||
            totalCap_ == 0 || totalCap_ > SUPPLY_HARD_LIMIT ||
            perIdCap_ == 0 || perIdCap_ > totalCap_ ||
            royaltyReceiver_ == address(0) || royaltyBps_ > ROYALTY_HARD_LIMIT
        ) revert InvalidCollectionConfiguration();
        maxTotalMinted = totalCap_;
        maxMintedPerId = perIdCap_;
        _collectionURI = uriTemplate_;
        _setDefaultRoyalty(royaltyReceiver_, royaltyBps_);
    }

    function uri(uint256) public view override returns (string memory) {
        return _collectionURI;
    }

    function setURI(string calldata nextURI) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        if (bytes(nextURI).length == 0 || bytes(nextURI).length > 512)
            revert InvalidCollectionConfiguration();
        _collectionURI = nextURI;
        _setURI(nextURI);
        emit CollectionURIUpdated(nextURI);
    }

    function freezeMetadata() external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        metadataFrozen = true;
        emit MetadataFrozen();
    }

    function pauseMinting() external onlyOwner { _pause(); }
    function unpauseMinting() external onlyOwner { _unpause(); }

    function mintReserved(
        address recipient, uint256 tokenId, uint256 quantity
    ) external onlyOwner whenNotPaused nonReentrant {
        if (recipient == address(0) || quantity == 0)
            revert InvalidCollectionConfiguration();
        if (quantity > maxTotalMinted - totalMinted ||
            quantity > maxMintedPerId - mintedById[tokenId])
            revert SupplyCapExceeded();
        totalMinted += quantity;
        mintedById[tokenId] += quantity; // before ERC1155 receiver callback
        _mint(recipient, tokenId, quantity, "");
        emit ReservedMint(recipient, tokenId, quantity);
    }

    /// @dev M5 phase mint: global cap AND per token ID lifetime cap.
    function _mintPhaseTokens(address minter, uint256 tokenId, uint256 quantity)
        internal override
    {
        if (quantity > maxTotalMinted - totalMinted ||
            quantity > maxMintedPerId - mintedById[tokenId])
            revert SupplyCapExceeded();
        totalMinted += quantity;
        mintedById[tokenId] += quantity;
        _mint(minter, tokenId, quantity, "");
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
