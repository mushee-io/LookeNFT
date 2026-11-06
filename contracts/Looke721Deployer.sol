// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {Looke721Collection} from "./Looke721Collection.sol";

/**
 * Immutable, factory-bound CREATE2 deployer.
 * Splits ERC721 collection initcode out of the main factory's runtime to comply
 * with EIP-170. This custom implementation is NOT independently audited.
 */
contract Looke721Deployer {
    error OnlyFactory();
    address public immutable factory;

    constructor() {
        factory = msg.sender;
    }

    function deploy(
        string calldata name_, string calldata symbol_, string calldata baseURI_,
        uint256 maxSupply_, address creator_, address royaltyReceiver_,
        uint96 royaltyBps_, bytes32 salt_
    ) external returns (address collection) {
        if (msg.sender != factory) revert OnlyFactory();
        collection = address(new Looke721Collection{salt:salt_}(
            name_, symbol_, baseURI_, maxSupply_, creator_, royaltyReceiver_, royaltyBps_
        ));
    }

    function predict(
        string calldata name_, string calldata symbol_, string calldata baseURI_,
        uint256 maxSupply_, address creator_, address royaltyReceiver_,
        uint96 royaltyBps_, bytes32 salt_
    ) external view returns (address) {
        bytes32 creationHash = keccak256(abi.encodePacked(
            type(Looke721Collection).creationCode,
            abi.encode(name_, symbol_, baseURI_, maxSupply_, creator_, royaltyReceiver_, royaltyBps_)
        ));
        return Create2.computeAddress(salt_, creationHash, address(this));
    }
}
