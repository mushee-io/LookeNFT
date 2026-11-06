// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Looke721Deployer} from "./Looke721Deployer.sol";
import {Looke1155Deployer} from "./Looke1155Deployer.sol";

/**
 * LookeNFT operator-only Ultra EVM Testnet collection factory V3. All creation entrypoints require owner.
 * Dedicated factory-bound deployers keep CREATE2 collection initcode out of
 * this contract's runtime, respecting EIP-170 while retaining deterministic
 * creator-owned ERC721/1155 deployments. No upgradeability, fees or custody.
 * Custom code NOT independently audited. Deployments gated by human approval.
 */
contract LookeOwnerCollectionFactory is Ownable, ReentrancyGuard {
    error WrongChain();
    error InvalidSalt();
    error SaltAlreadyConsumed();

    uint256 public constant ULTRA_TESTNET_CHAIN_ID = 18881;
    uint256 public constant VERSION = 3;

    Looke721Deployer public immutable erc721Deployer;
    Looke1155Deployer public immutable erc1155Deployer;

    mapping(bytes32 => bool) public consumedSalt;
    mapping(address => bool) public isCollection;

    event CollectionCreated(
        address indexed creator,
        address indexed collection,
        uint8 indexed standard,
        bytes32 derivedSalt,
        uint256 totalSupplyCap,
        uint256 perIdCap,
        uint96 royaltyBps
    );

    constructor(address operator) Ownable(operator) {
        if (block.chainid != ULTRA_TESTNET_CHAIN_ID) revert WrongChain();
        erc721Deployer = new Looke721Deployer();
        erc1155Deployer = new Looke1155Deployer();
    }

    function deriveSalt(address creator, bytes32 userSalt) public pure returns (bytes32) {
        if (userSalt == bytes32(0)) revert InvalidSalt();
        return keccak256(abi.encode(creator, userSalt));
    }

    function createERC721(
        string calldata name_,
        string calldata symbol_,
        string calldata baseURI_,
        uint256 maxSupply_,
        address royaltyReceiver_,
        uint96 royaltyBps_,
        bytes32 userSalt_
    ) external onlyOwner nonReentrant returns (address collection) {
        bytes32 salt = deriveSalt(msg.sender, userSalt_);
        if (consumedSalt[salt]) revert SaltAlreadyConsumed();
        consumedSalt[salt] = true;
        collection = erc721Deployer.deploy(
            name_, symbol_, baseURI_, maxSupply_, msg.sender, royaltyReceiver_, royaltyBps_, salt
        );
        isCollection[collection] = true;
        emit CollectionCreated(msg.sender, collection, 1, salt, maxSupply_, 1, royaltyBps_);
    }

    function createERC1155(
        string calldata uriTemplate_,
        uint256 totalCap_,
        uint256 perIdCap_,
        address royaltyReceiver_,
        uint96 royaltyBps_,
        bytes32 userSalt_
    ) external nonReentrant returns (address collection) {
        bytes32 salt = deriveSalt(msg.sender, userSalt_);
        if (consumedSalt[salt]) revert SaltAlreadyConsumed();
        consumedSalt[salt] = true;
        collection = erc1155Deployer.deploy(
            uriTemplate_, totalCap_, perIdCap_, msg.sender, royaltyReceiver_, royaltyBps_, salt
        );
        isCollection[collection] = true;
        emit CollectionCreated(msg.sender, collection, 2, salt, totalCap_, perIdCap_, royaltyBps_);
    }

    function predictERC721(
        address creator_,
        string calldata name_,
        string calldata symbol_,
        string calldata baseURI_,
        uint256 maxSupply_,
        address royaltyReceiver_,
        uint96 royaltyBps_,
        bytes32 userSalt_
    ) external view returns (address) {
        return erc721Deployer.predict(
            name_, symbol_, baseURI_, maxSupply_, creator_, royaltyReceiver_, royaltyBps_,
            deriveSalt(creator_, userSalt_)
        );
    }

    function predictERC1155(
        address creator_,
        string calldata uriTemplate_,
        uint256 totalCap_,
        uint256 perIdCap_,
        address royaltyReceiver_,
        uint96 royaltyBps_,
        bytes32 userSalt_
    ) external view returns (address) {
        return erc1155Deployer.predict(
            uriTemplate_, totalCap_, perIdCap_, creator_, royaltyReceiver_, royaltyBps_,
            deriveSalt(creator_, userSalt_)
        );
    }
}
