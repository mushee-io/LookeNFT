// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/** Local-only payout failure fixture. Never deployed on Ultra EVM Testnet. */
contract LookeRejectPayout {
    receive() external payable { revert("PAYOUT_REFUSED"); }
}
