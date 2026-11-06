// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILookePhaseMint {
    function mintFromPhase(
        uint256 phaseId, uint256 tokenId, uint256 quantity, uint256 allowance,
        bytes32[] calldata proof, uint256 nonce, uint256 requestDeadline
    ) external payable;
}

/**
 * Deterministic local adversarial fixture. Not deployed to Ultra EVM Testnet.
 * Exercises receiver callback reentrancy and rejection of native-UOS refunds.
 */
contract MintAdversary {
    ILookePhaseMint public target;
    uint256 public phase;
    uint256 public deadline;
    bool public reentered;
    bool public rejectRefund;

    function configure(address collection, uint256 phaseId, uint256 expires, bool rejectNative) external {
        target = ILookePhaseMint(collection);
        phase = phaseId;
        deadline = expires;
        rejectRefund = rejectNative;
    }

    function buy(uint256 tokenId) external payable {
        bytes32[] memory none = new bytes32[](0);
        target.mintFromPhase{value:msg.value}(phase, tokenId, 1, 0, none, 0, deadline);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external returns (bytes4)
    {
        _attemptReentry(0);
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256 tokenId, uint256, bytes calldata)
        external returns (bytes4)
    {
        _attemptReentry(tokenId);
        return this.onERC1155Received.selector;
    }

    function _attemptReentry(uint256 tokenId) internal {
        if (!reentered) {
            reentered = true;
            bytes32[] memory none = new bytes32[](0);
            try target.mintFromPhase(phase, tokenId, 1, 0, none, 1, deadline) {
                revert("REENTRANCY_UNEXPECTEDLY_SUCCEEDED");
            } catch {}
        }
    }

    receive() external payable {
        if (rejectRefund) revert("REFUND_REFUSED");
    }
}
