import {isAddress,zeroAddress} from "viem";

/**
 * Ultra EVM Testnet sometimes represents the receipt `to` field of a
 * successful CREATE transaction as the zero address, not JSON null.
 * The *transaction* `to` field is authoritative for the CREATE direction.
 * Never infer a successful deployment from a transaction hash alone.
 */
export function isSuccessfulDirectCreation(
 transaction:{to:string|null|undefined},
 receipt:{status:string;to:string|null|undefined;contractAddress:string|null|undefined}
):boolean{
 const receiptTo=receipt.to?.toLowerCase();
 return transaction.to == null &&
  (receiptTo == null || receiptTo===zeroAddress.toLowerCase()) &&
  receipt.status==="success" &&
  typeof receipt.contractAddress==="string" &&
  isAddress(receipt.contractAddress,{strict:false}) &&
  receipt.contractAddress.toLowerCase()!==zeroAddress.toLowerCase();
}
