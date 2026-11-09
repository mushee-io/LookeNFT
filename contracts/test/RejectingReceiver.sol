// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/** Test helper only. Always rejects ERC-721/ERC-1155 safe receiver callbacks. */
contract RejectingReceiver {
    // No IERC721Receiver or IERC1155Receiver implementation.
}
