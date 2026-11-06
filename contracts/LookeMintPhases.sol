// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * M5 shared mint policy. No phase exists on deployment: public mint OFF.
 * Creator schedules immutable phase terms; may cancel, not reprice.
 * Allowlist leaves are domain-separated by chain/collection/phase.
 * Request nonces prevent successful calldata replay. ETH in EVM = native UOS.
 * Custom project logic has NOT received an independent audit.
 */
abstract contract LookeMintPhases is Ownable, Pausable, ReentrancyGuard {
    uint256 public constant ULTRA_TESTNET_CHAIN_ID = 18881;
    uint256 public constant MAX_MINT_PRICE_WEI = 1_000 ether;
    uint256 public constant MAX_MINT_LIFETIME_PER_WALLET = 1_000;
    uint256 public constant MAX_PHASES = 100;
    uint256 public constant MAX_PHASE_DURATION = 90 days;

    struct MintPhase {
        uint64 start;
        uint64 end;
        uint96 unitPrice;
        uint32 walletCap;
        uint32 phaseCap;
        uint32 minted;
        bytes32 merkleRoot;
        bool cancelled;
    }

    mapping(uint256 => MintPhase) public mintPhases;
    mapping(uint256 => mapping(address => uint256)) public mintedByWallet;
    mapping(uint256 => mapping(address => uint256)) public mintNonces;
    mapping(address => uint256) public lifetimeMintedByWallet;
    uint256 public phaseCount;
    uint256 public accruedProceeds;

    error WrongMintChain();
    error BadMintPhase();
    error MintInactive();
    error InvalidMintQuantity();
    error MintSupplyExceeded();
    error WalletMintCapExceeded();
    error InvalidAllowlistProof();
    error InvalidMintNonce();
    error MintRequestExpired();
    error IncorrectMintPayment();
    error NativeTransferFailed();
    error WithdrawAmountExceedsProceeds();

    event MintPhaseScheduled(
        uint256 indexed phaseId, uint64 start, uint64 end, uint96 unitPrice,
        uint32 walletCap, uint32 phaseCap, bytes32 merkleRoot
    );
    event MintPhaseCancelled(uint256 indexed phaseId);
    event PhaseMint(
        uint256 indexed phaseId, address indexed minter, uint256 indexed tokenId,
        uint256 quantity, uint256 nonce, uint256 payment, uint256 refund
    );
    event ProceedsWithdrawn(address indexed recipient, uint256 amount);

    constructor(address creator) Ownable(creator) {
        if (block.chainid != ULTRA_TESTNET_CHAIN_ID) revert WrongMintChain();
    }

    function scheduleMintPhase(
        uint64 start, uint64 end, uint96 unitPrice,
        uint32 walletCap, uint32 phaseCap, bytes32 merkleRoot
    ) external onlyOwner returns (uint256 phaseId) {
        if (
            phaseCount >= MAX_PHASES ||
            start == 0 || end <= start ||
            uint256(end) - uint256(start) > MAX_PHASE_DURATION ||
            end <= block.timestamp ||
            unitPrice > MAX_MINT_PRICE_WEI ||
            walletCap == 0 || walletCap > MAX_MINT_LIFETIME_PER_WALLET ||
            phaseCap == 0 || walletCap > phaseCap
        ) revert BadMintPhase();
        phaseId = ++phaseCount;
        mintPhases[phaseId] = MintPhase({
            start: start, end: end, unitPrice: unitPrice,
            walletCap: walletCap, phaseCap: phaseCap, minted: 0,
            merkleRoot: merkleRoot, cancelled: false
        });
        emit MintPhaseScheduled(phaseId, start, end, unitPrice, walletCap, phaseCap, merkleRoot);
    }

    function cancelMintPhase(uint256 phaseId) external onlyOwner {
        MintPhase storage phase = mintPhases[phaseId];
        if (phaseId == 0 || phaseId > phaseCount || phase.cancelled) revert BadMintPhase();
        phase.cancelled = true;
        emit MintPhaseCancelled(phaseId);
    }

    /** OpenZeppelin-standard double-hash Merkle leaf (ABI encoded). */
    function allowlistLeaf(
        uint256 phaseId, address wallet, uint256 allowance
    ) public view returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(
            block.chainid, address(this), phaseId, wallet, allowance
        ))));
    }

    /**
     * NFTs mint only to msg.sender; no arbitrary recipient parameter.
     * tokenId MUST be 0 for ERC721. ERC1155 uses the supplied token ID.
     */
    function mintFromPhase(
        uint256 phaseId, uint256 tokenId, uint256 quantity,
        uint256 allowance, bytes32[] calldata proof,
        uint256 nonce, uint256 requestDeadline
    ) external payable nonReentrant whenNotPaused {
        if (block.chainid != ULTRA_TESTNET_CHAIN_ID) revert WrongMintChain();
        MintPhase storage phase = mintPhases[phaseId];
        if (phaseId == 0 || phaseId > phaseCount) revert BadMintPhase();
        if (phase.cancelled || block.timestamp < phase.start || block.timestamp > phase.end)
            revert MintInactive();
        if (block.timestamp > requestDeadline || requestDeadline > phase.end)
            revert MintRequestExpired();
        if (quantity == 0 || quantity > 1_000) revert InvalidMintQuantity();
        if (nonce != mintNonces[phaseId][msg.sender]) revert InvalidMintNonce();
        if (quantity > uint256(phase.phaseCap) - uint256(phase.minted))
            revert MintSupplyExceeded();
        if (quantity > uint256(phase.walletCap) - mintedByWallet[phaseId][msg.sender] ||
            quantity > MAX_MINT_LIFETIME_PER_WALLET - lifetimeMintedByWallet[msg.sender])
            revert WalletMintCapExceeded();
        if (phase.merkleRoot != bytes32(0)) {
            if (allowance == 0 || mintedByWallet[phaseId][msg.sender] + quantity > allowance ||
                !MerkleProof.verifyCalldata(
                    proof, phase.merkleRoot, allowlistLeaf(phaseId, msg.sender, allowance)
                )
            ) revert InvalidAllowlistProof();
        } else if (allowance != 0 || proof.length != 0) {
            revert InvalidAllowlistProof();
        }

        uint256 payment = uint256(phase.unitPrice) * quantity;
        if (msg.value < payment) revert IncorrectMintPayment();

        // Checks/effects BEFORE token receiver callbacks and refund.
        phase.minted += uint32(quantity);
        mintedByWallet[phaseId][msg.sender] += quantity;
        lifetimeMintedByWallet[msg.sender] += quantity;
        mintNonces[phaseId][msg.sender] = nonce + 1;
        accruedProceeds += payment;

        _mintPhaseTokens(msg.sender, tokenId, quantity);

        uint256 refund = msg.value - payment;
        if (refund != 0) {
            (bool ok,) = payable(msg.sender).call{value: refund}("");
            if (!ok) revert NativeTransferFailed();
        }
        emit PhaseMint(phaseId, msg.sender, tokenId, quantity, nonce, payment, refund);
    }

    function withdrawProceeds(address payable recipient, uint256 amount)
        external onlyOwner nonReentrant
    {
        if (recipient == address(0)) revert NativeTransferFailed();
        if (amount == 0 || amount > accruedProceeds) revert WithdrawAmountExceedsProceeds();
        accruedProceeds -= amount;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
        emit ProceedsWithdrawn(recipient, amount);
    }

    function _mintPhaseTokens(address minter, uint256 tokenId, uint256 quantity)
        internal virtual;
}
