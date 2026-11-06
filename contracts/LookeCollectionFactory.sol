// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Looke721Collection} from "./Looke721Collection.sol";
import {Looke1155Collection} from "./Looke1155Collection.sol";

/**
 * @title LookeCollectionFactory
 * @notice Permissionless creator-pays factory, restricted at bytecode level
 *         to Ultra EVM Testnet (chainId=18881). No admin keys or fees.
 * @dev This contract and custom collection logic are NOT independently audited.
 */
contract LookeCollectionFactory is ReentrancyGuard {
    error WrongChain();
    error InvalidSalt();
    error SaltAlreadyConsumed();

    uint256 public constant ULTRA_TESTNET_CHAIN_ID = 18881;
    uint256 public constant VERSION = 2;

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

    constructor() {
        if (block.chainid != ULTRA_TESTNET_CHAIN_ID) revert WrongChain();
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
    ) external nonReentrant returns (address collection) {
        bytes32 salt = deriveSalt(msg.sender, userSalt_);
        if (consumedSalt[salt]) revert SaltAlreadyConsumed();
        consumedSalt[salt] = true;
        collection = address(new Looke721Collection{salt: salt}(
            name_, symbol_, baseURI_, maxSupply_, msg.sender, royaltyReceiver_, royaltyBps_
        ));
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
        collection = address(new Looke1155Collection{salt: salt}(
            uriTemplate_, totalCap_, perIdCap_, msg.sender, royaltyReceiver_, royaltyBps_
        ));
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
        bytes32 creationHash = keccak256(abi.encodePacked(
            type(Looke721Collection).creationCode,
            abi.encode(name_, symbol_, baseURI_, maxSupply_, creator_, royaltyReceiver_, royaltyBps_)
        ));
        return Create2.computeAddress(deriveSalt(creator_, userSalt_), creationHash);
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
        bytes32 creationHash = keccak256(abi.encodePacked(
            type(Looke1155Collection).creationCode,
            abi.encode(uriTemplate_, totalCap_, perIdCap_, creator_, royaltyReceiver_, royaltyBps_)
        ));
        return Create2.computeAddress(deriveSalt(creator_, userSalt_), creationHash);
    }
}
