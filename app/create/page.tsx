"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  createPublicClient, decodeEventLog, encodeFunctionData, getAddress, http,
  isAddress, parseEventLogs, type Address, type Hex
} from "viem";
import { useWalletSession } from "@/components/WalletSessionProvider";
import { ULTRA_TESTNET } from "@/lib/network";
import {
  M4_DEPLOY_ENABLED, M4_FACTORY_ADDRESS, factoryAbi, collectionAbi,
  validateCollectionDraft, type CollectionDraft, type ValidatedCollection
} from "@/lib/m4/factory";

const rpc = createPublicClient({
  transport: http(ULTRA_TESTNET.rpcUrl, { timeout: 12000, retryCount: 1 })
});
type Preflight = {
  data: Hex;
  predicted: Address;
  config: ValidatedCollection;
  creator: Address;
  factory: Address;
};
const initial: CollectionDraft = {
  standard: "erc721",
  name: "", symbol: "", uri: "", totalCap: "100",
  perIdCap: "10", royaltyBps: "500", royaltyReceiver: "", salt: ""
};
function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" + Array.from(bytes, v => v.toString(16).padStart(2, "0")).join("")) as Hex;
}

export default function CreatePage() {
  const wallet = useWalletSession();
  const [draft, setDraft] = useState<CollectionDraft>(initial);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reviewed, setReviewed] = useState<Preflight | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);

  // Any change to draft, active account or chain invalidates old signed calldata.
  useEffect(() => {
    setReviewed(null);
    setAcknowledged(false);
  }, [draft, wallet.address, wallet.chainId]);

  function edit<K extends keyof CollectionDraft>(key: K, value: CollectionDraft[K]) {
    setDraft(old => ({ ...old, [key]: value }));
    setError(null);
    setTxHash(null);
    setManifest(null);
  }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setReviewed(null);
    setTxHash(null);
    setManifest(null);
    try {
      if (!wallet.address || wallet.chainId !== 18881) throw new Error("Connect an Ultra EVM Testnet account first");
      const next = { ...draft, royaltyReceiver: draft.royaltyReceiver || wallet.address };
      const config = validateCollectionDraft(next);
      if (!isAddress(M4_FACTORY_ADDRESS, { strict: false })) throw new Error("Operator has not configured a verified Testnet factory address");
      const factory = getAddress(M4_FACTORY_ADDRESS);
      if (await rpc.getChainId() !== 18881) throw new Error("RPC did not report Ultra EVM Testnet");
      const bytecode = await rpc.getCode({ address: factory });
      if (!bytecode || bytecode === "0x") throw new Error("Factory has no deployed bytecode on Ultra EVM Testnet");
      const [factoryChain, factoryVersion] = await Promise.all([
        rpc.readContract({ address: factory, abi: factoryAbi, functionName: "ULTRA_TESTNET_CHAIN_ID" }),
        rpc.readContract({ address: factory, abi: factoryAbi, functionName: "VERSION" })
      ]);
      if (factoryChain !== 18881n || factoryVersion !== 1n)
        throw new Error("Deployed factory identity/version mismatch");
      const creator = getAddress(wallet.address);
      const predicted = config.standard === "erc721"
        ? await rpc.readContract({
          address: factory, abi: factoryAbi, functionName: "predictERC721",
          args: [creator, config.name, config.symbol, config.uri, config.totalCap, config.royaltyReceiver, config.royaltyBps, config.salt]
        })
        : await rpc.readContract({
          address: factory, abi: factoryAbi, functionName: "predictERC1155",
          args: [creator, config.uri, config.totalCap, config.perIdCap, config.royaltyReceiver, config.royaltyBps, config.salt]
        });
      if (await rpc.getCode({ address: predicted }) !== undefined)
        throw new Error("Predicted CREATE2 address is already deployed; generate a new salt");
      const data = config.standard === "erc721"
        ? encodeFunctionData({
          abi: factoryAbi, functionName: "createERC721",
          args: [config.name, config.symbol, config.uri, config.totalCap, config.royaltyReceiver, config.royaltyBps, config.salt]
        })
        : encodeFunctionData({
          abi: factoryAbi, functionName: "createERC1155",
          args: [config.uri, config.totalCap, config.perIdCap, config.royaltyReceiver, config.royaltyBps, config.salt]
        });
      setReviewed({ config, predicted, data, creator, factory });
    } catch(e) {
      setError(e instanceof Error ? e.message : "Unable to review deployment");
    } finally { setBusy(false); }
  }

  async function deploy() {
    if (!reviewed || !acknowledged || !M4_DEPLOY_ENABLED ||
        !wallet.authenticated || wallet.pending || busy) return;
    setError(null);
    setBusy(true);
    setManifest(null);
    try {
      if (wallet.address?.toLowerCase() !== reviewed.creator.toLowerCase() || wallet.chainId !== 18881)
        throw new Error("Wallet changed since the last approved review");
      // Only this user click may invoke eth_sendTransaction and the wallet must ask for approval.
      const hash = await wallet.submitFactoryDeployment(reviewed.factory, reviewed.data);
      setTxHash(hash);
      const receipt = await rpc.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 180_000 });
      if (receipt.status !== "success") throw new Error("Wallet transaction failed on Testnet");
      const transaction = await rpc.getTransaction({ hash });
      if (transaction.chainId !== 18881 || transaction.from.toLowerCase() !== reviewed.creator.toLowerCase() ||
          transaction.to?.toLowerCase() !== reviewed.factory.toLowerCase() ||
          transaction.input.toLowerCase() !== reviewed.data.toLowerCase())
        throw new Error("Receipt does not match reviewed creator, chain, factory and calldata");
      const events = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "CollectionCreated" });
      const event = events.find(e =>
        e.address.toLowerCase() === reviewed.factory.toLowerCase() &&
        e.args.creator.toLowerCase() === reviewed.creator.toLowerCase() &&
        e.args.collection.toLowerCase() === reviewed.predicted.toLowerCase() &&
        Number(e.args.standard) === (reviewed.config.standard === "erc721" ? 1 : 2)
      );
      if (!event) throw new Error("Confirmed transaction lacks the expected factory CollectionCreated event");
      const [deployedCode, owner, registered, interfaceClaim] = await Promise.all([
        rpc.getCode({ address: reviewed.predicted }),
        rpc.readContract({ address: reviewed.predicted, abi: collectionAbi, functionName: "owner" }),
        rpc.readContract({ address: reviewed.factory, abi: factoryAbi, functionName: "isCollection", args: [reviewed.predicted] }),
        rpc.readContract({
          address: reviewed.predicted, abi: collectionAbi, functionName: "supportsInterface",
          args: [reviewed.config.standard === "erc721" ? "0x80ac58cd" : "0xd9b67a26"]
        })
      ]);
      if (!deployedCode || deployedCode === "0x" || owner.toLowerCase() !== reviewed.creator.toLowerCase() ||
          !registered || !interfaceClaim) throw new Error("On-chain collection code, ownership or interface validation failed");
      setManifest({
        schema: "lookenft/m4-testnet-deployment/v1",
        verificationLevel: "primary-rpc-receipt-only",
        chainId: 18881, standard: reviewed.config.standard,
        factory: reviewed.factory, creator: reviewed.creator, collection: reviewed.predicted,
        txHash: hash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
        supplyCap: reviewed.config.totalCap.toString(),
        perIdCap: reviewed.config.perIdCap.toString(), royaltyBps: reviewed.config.royaltyBps,
        royaltyReceiver: reviewed.config.royaltyReceiver,
        metadataURI: reviewed.config.uri, metadataMutableUntilFrozen: true,
        sourceVerified: false, independentlyAudited: false, independentExplorerVerified: false,
        note: "No independent verification until operator CLI and explorer checks pass."
      });
    } catch(e) {
      setError(e instanceof Error ? e.message : "Deployment or receipt verification failed");
    } finally { setBusy(false); }
  }

  const gateMessage = !M4_DEPLOY_ENABLED
    ? "Deployment is disabled by the M4 operator gate."
    : !isAddress(M4_FACTORY_ADDRESS, { strict: false })
      ? "The authorised Testnet factory address is not configured."
      : !wallet.address || wallet.chainId !== 18881
        ? "Connect an Ultra EVM Testnet wallet."
        : !wallet.authenticated ? "Sign in with your wallet before deploying."
          : "A separate wallet approval is required for every Testnet deployment.";

  return (
    <section className="interior creator-page">
      <p className="eyebrow">LOOKE NFT / CREATOR STUDIO · ULTRA EVM TESTNET</p>
      <h1>Make your collection.</h1>
      <p className="interior-copy">
        Prepare a non-upgradeable ERC-721 or ERC-1155 collection. This M4 builder
        performs read-only preflight checks; actual deployment is disabled unless
        an operator separately approves a real Testnet factory and the connected
        creator confirms the transaction inside their own wallet.
      </p>
      <div className="index-warning" role="status">{gateMessage} {manifest ? "Verified from primary RPC; independent operator checks still required." : "No collection has been deployed by this page."}</div>

      <form className="creator-form" onSubmit={e => void review(e)}>
        <div className="creator-form-grid">
          <label>Token standard
            <select value={draft.standard} onChange={e=>edit("standard",e.target.value as CollectionDraft["standard"])}>
              <option value="erc721">ERC-721 · Unique artworks</option>
              <option value="erc1155">ERC-1155 · Editions</option>
            </select>
          </label>
          {draft.standard==="erc721" && <>
            <label>Collection name <input maxLength={80} value={draft.name} onChange={e=>edit("name",e.target.value)} placeholder="Looke Originals"/></label>
            <label>Symbol <input maxLength={15} value={draft.symbol} onChange={e=>edit("symbol",e.target.value)} placeholder="LKO"/></label>
          </>}
          <label className="creator-wide">Metadata URI
            <input maxLength={512} value={draft.uri} onChange={e=>edit("uri",e.target.value)}
              placeholder={draft.standard==="erc721"?"ipfs://CID/metadata/":"ipfs://CID/{id}.json"}/>
            <span>Use uploaded, pinned metadata from a trusted HTTPS/IPFS host. M6 will provide media authorisation and moderation.</span>
          </label>
          <label>Total lifetime supply cap
            <input inputMode="numeric" value={draft.totalCap} onChange={e=>edit("totalCap",e.target.value)} />
          </label>
          {draft.standard==="erc1155" && <label>Maximum units per token ID
            <input inputMode="numeric" value={draft.perIdCap} onChange={e=>edit("perIdCap",e.target.value)}/>
          </label>}
          <label>Royalty basis points (0–1000)
            <input inputMode="numeric" value={draft.royaltyBps} onChange={e=>edit("royaltyBps",e.target.value)}/>
            <span>500 = 5%. ERC-2981 signals royalties; it cannot force third-party payment.</span>
          </label>
          <label>Royalty recipient wallet
            <input value={draft.royaltyReceiver} onChange={e=>edit("royaltyReceiver",e.target.value)}
              placeholder={wallet.address??"Connect a wallet to default to its address"}/>
          </label>
          <label className="creator-wide">Unique deployment salt
            <div className="salt-row">
              <input readOnly value={draft.salt} placeholder="Generate once for deterministic CREATE2 address"/>
              <button type="button" className="secondary-link" onClick={()=>edit("salt",randomSalt())}>Generate salt</button>
            </div>
          </label>
        </div>
        <button type="submit" className="primary-link" disabled={busy || wallet.pending}>
          {busy ? "Reviewing…" : "Review Testnet deployment (read-only)"}
        </button>
      </form>

      {reviewed && <div className="creator-preflight">
        <h2>Review before wallet approval</h2>
        <dl>
          <div><dt>Creator</dt><dd>{reviewed.creator}</dd></div>
          <div><dt>Factory</dt><dd>{reviewed.factory}</dd></div>
          <div><dt>Predicted collection address</dt><dd>{reviewed.predicted}</dd></div>
          <div><dt>Standard</dt><dd>{reviewed.config.standard.toUpperCase()}</dd></div>
          <div><dt>Maximum total units</dt><dd>{reviewed.config.totalCap.toString()}</dd></div>
          <div><dt>Lifetime per-ID cap</dt><dd>{reviewed.config.perIdCap.toString()}</dd></div>
          <div><dt>Royalty</dt><dd>{reviewed.config.royaltyBps/100}% (ERC-2981 signalling)</dd></div>
        </dl>
        <p className="wallet-note">Ownership is assigned to the approving wallet. Creator-only reserved mint functions exist in the contract; public minting, sales and token purchases are not enabled by M4.</p>
        <label className="creator-ack">
          <input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)}/>
          I have reviewed the Testnet contract, chain, supply, royalty and wallet gas fees; the collection will be immutable except for owner-controlled metadata changes until frozen.
        </label>
        <button className="primary-link" type="button" disabled={
          !acknowledged || !M4_DEPLOY_ENABLED || !wallet.authenticated ||
          wallet.pending || busy || wallet.chainId !== 18881
        } onClick={()=>void deploy()}>
          {busy?"Checking receipt…":"Confirm deployment in wallet"}
        </button>
      </div>}

      {txHash && <p className="index-warning">Wallet submitted Testnet transaction:
        {" "}<a href={ULTRA_TESTNET.explorerUrl+"/tx/"+txHash} target="_blank" rel="noopener noreferrer">{txHash}</a>.
        A submitted transaction does not prove deployment until receipt and contract checks complete.</p>}
      {error && <p role="alert" className="index-warning">{error}</p>}
      {manifest && <div className="creator-preflight">
        <h2>Primary-RPC observed deployment manifest</h2>
        <p className="wallet-note">Independently reconcile this against Blockscout and another RPC before registering in M3.</p>
        <pre className="creator-json">{JSON.stringify(manifest,null,2)}</pre>
        <button className="secondary-link" type="button" onClick={()=>void navigator.clipboard.writeText(JSON.stringify(manifest,null,2))}>Copy manifest</button>
      </div>}
    </section>
  );
}
