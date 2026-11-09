// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {Looke1155Collection} from "./Looke1155Collection.sol";

/**
 * Immutable, factory-bound ERC1155 CREATE2 deployer for EIP-170-safe factory size.
 * This custom implementation is NOT independently audited.
 */
contract Looke1155Deployer {
    error OnlyFactory();
    address public immutable factory;

    constructor() {
        factory = msg.sender;
    }

    function deploy(
        string calldata uriTemplate_, uint256 totalCap_, uint256 perIdCap_,
        address creator_, address royaltyReceiver_, uint96 royaltyBps_, bytes32 salt_
    ) external returns (address collection) {
        if (msg.sender != factory) revert OnlyFactory();
        collection = address(new Looke1155Collection{salt:salt_}(
            uriTemplate_, totalCap_, perIdCap_, creator_, royaltyReceiver_, royaltyBps_
        ));
    }

    function predict(
        string calldata uriTemplate_, uint256 totalCap_, uint256 perIdCap_,
        address creator_, address royaltyReceiver_, uint96 royaltyBps_, bytes32 salt_
    ) external view returns (address) {
        bytes32 creationHash = keccak256(abi.encodePacked(
            type(Looke1155Collection).creationCode,
            abi.encode(uriTemplate_, totalCap_, perIdCap_, creator_, royaltyReceiver_, royaltyBps_)
        ));
        return Create2.computeAddress(salt_, creationHash, address(this));
    }
}
