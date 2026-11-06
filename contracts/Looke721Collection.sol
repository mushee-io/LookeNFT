// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {LookeMintPhases} from "./LookeMintPhases.sol";

/**
 * @title Looke721Collection
 * @notice Non-upgradeable creator-owned ERC-721 collection for Ultra EVM Testnet.
 * @dev M5: public/allowlist phases are inactive until creator explicitly schedules one.
 *      Pausing intentionally suspends minting, not standard owner transfers.
 *      Royalties are immutable ERC-2981 signalling, not marketplace enforcement.
 */
contract Looke721Collection is ERC721, ERC2981, LookeMintPhases {
    using Strings for uint256;

    error InvalidCollectionConfiguration();
    error SupplyCapExceeded();
    error MetadataIsFrozen();

    uint256 public constant SUPPLY_HARD_LIMIT = 1_000_000;
    uint96 public constant ROYALTY_HARD_LIMIT = 1_000; // 10% maximum

    uint256 public immutable maxSupply;
    uint256 public totalMinted;
    bool public metadataFrozen;

    string private _collectionBaseURI;

    event ReservedMint(address indexed to, uint256 indexed tokenId);
    event BaseURIUpdated(string newBaseURI);
    event MetadataFrozen();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        uint256 maxSupply_,
        address creator_,
        address royaltyReceiver_,
        uint96 royaltyBps_
    ) ERC721(name_, symbol_) LookeMintPhases(creator_) {
        if (
            bytes(name_).length == 0 || bytes(name_).length > 80 ||
            bytes(symbol_).length == 0 || bytes(symbol_).length > 15 ||
            bytes(baseURI_).length == 0 || bytes(baseURI_).length > 512 ||
            maxSupply_ == 0 || maxSupply_ > SUPPLY_HARD_LIMIT ||
            royaltyReceiver_ == address(0) || royaltyBps_ > ROYALTY_HARD_LIMIT
        ) revert InvalidCollectionConfiguration();
        maxSupply = maxSupply_;
        _collectionBaseURI = baseURI_;
        _setDefaultRoyalty(royaltyReceiver_, royaltyBps_);
    }

    function baseTokenURI() external view returns (string memory) {
        return _collectionBaseURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return _collectionBaseURI;
    }

    function setBaseURI(string calldata nextURI) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        if (bytes(nextURI).length == 0 || bytes(nextURI).length > 512)
            revert InvalidCollectionConfiguration();
        _collectionBaseURI = nextURI;
        emit BaseURIUpdated(nextURI);
    }

    function freezeMetadata() external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        metadataFrozen = true;
        emit MetadataFrozen();
    }

    function pauseMinting() external onlyOwner { _pause(); }
    function unpauseMinting() external onlyOwner { _unpause(); }

    /// @dev Reserved admin mint for testing / creator reserves, not M5 public sales.
    function mintReserved(address recipient) external onlyOwner whenNotPaused nonReentrant returns (uint256 tokenId) {
        if (recipient == address(0)) revert InvalidCollectionConfiguration();
        if (totalMinted >= maxSupply) revert SupplyCapExceeded();
        tokenId = totalMinted + 1;
        totalMinted = tokenId; // set before the ERC721 receiver callback
        _safeMint(recipient, tokenId);
        emit ReservedMint(recipient, tokenId);
    }

    /// @dev M5 phase mint: mint sequential IDs, preserving lifetime supply.
    function _mintPhaseTokens(address minter, uint256 tokenId, uint256 quantity)
        internal override
    {
        if (tokenId != 0 || quantity == 0 || quantity > 20)
            revert InvalidMintQuantity();
        if (quantity > maxSupply - totalMinted) revert SupplyCapExceeded();
        for (uint256 i = 0; i < quantity; ++i) {
            uint256 nextId = ++totalMinted;
            _safeMint(minter, nextId);
        }
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
