/**
 * Submit signed Ethereum transactions to blockchain
 */

import Web3 from 'web3';
import { Transaction, FeeMarketEIP1559Transaction } from '@ethereumjs/tx';
import { Common } from '@ethereumjs/common';
import { CHAIN_RPC_URLS, EXPLORER_URLS } from './constants';

export interface SubmitOptions {
  signedTransaction: string;
  rpcUrl?: string;
  chainId?: number;
  waitForConfirmation?: boolean;
}

export interface SubmitResult {
  txHash: string;
  blockNumber?: number;
  confirmations?: number;
  status?: number;
}

/**
 * Submits a signed transaction to the blockchain
 */
export async function submitTransaction(
  options: SubmitOptions
): Promise<SubmitResult> {
  const { signedTransaction, rpcUrl, chainId, waitForConfirmation = false } = options;
  
  // Determine RPC URL
  let providerUrl: string;
  
  if (rpcUrl) {
    providerUrl = rpcUrl;
  } else if (chainId && CHAIN_RPC_URLS[chainId]) {
    providerUrl = CHAIN_RPC_URLS[chainId];
  } else {
    throw new Error(
      `RPC URL required. Either provide --rpc-url or use a known chain ID. ` +
      `Known chain IDs: ${Object.keys(CHAIN_RPC_URLS).join(', ')}`
    );
  }
  
  // Create web3 instance
  const web3 = new Web3(providerUrl);
  
  try {
    // Send transaction and get the promise
    const sendTx = web3.eth.sendSignedTransaction(signedTransaction);
    
    // Set up event handlers for immediate feedback
    sendTx.on('transactionHash', (hash: string) => {
      console.log(`\n✓ Transaction submitted successfully!`);
      console.log(`  Transaction Hash: ${hash}`);
      console.log(`  Explorer: ${getExplorerUrl(chainId, hash)}`);
    });
    
    if (waitForConfirmation) {
      // Wait for the transaction receipt (included in a block)
      console.log('⏳ Waiting for transaction confirmation...');
      const receipt = await sendTx;
      
      // Get current block number to calculate confirmations
      const currentBlock = await web3.eth.getBlockNumber();
      const confirmations = receipt.blockNumber ? currentBlock - receipt.blockNumber + 1 : 0;
      
      // receipt.status is a number: 1 for success, 0 for failure
      const status = typeof receipt.status === 'boolean' 
        ? (receipt.status ? 1 : 0)
        : (receipt.status !== undefined ? Number(receipt.status) : undefined);
      
      return {
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        confirmations: confirmations,
        status: status,
      };
    } else {
      // Just wait for transaction hash (submission to mempool)
      // Use a promise that resolves when transactionHash event fires
      const txHash = await new Promise<string>((resolve, reject) => {
        sendTx.on('transactionHash', resolve);
        sendTx.on('error', reject);
      });
      
      return {
        txHash: txHash,
      };
    }
  } catch (error: any) {
    const errorMessage = error.reason || error.message || String(error);
    throw new Error(`Transaction failed: ${errorMessage}`);
  }
}

/**
 * Decodes a signed transaction to extract the signer address
 */
export function getSignerAddress(signedTransaction: string, chainId?: number): string | undefined {
  try {
    const txBuffer = Buffer.from(signedTransaction.slice(2), 'hex');
    
    // Check transaction type (EIP-2718)
    const txType = txBuffer[0];
    
    // Try to decode based on transaction type
    // Typed transactions (EIP-2718) have type byte 0x01-0x7f
    if (txType >= 0x01 && txType <= 0x7f) {
      // Typed transaction (EIP-2718) - try EIP-1559 first
      try {
        const common = chainId 
          ? Common.custom({ chainId, networkId: chainId }, { hardfork: 'merge' })
          : undefined;
        const tx = common
          ? FeeMarketEIP1559Transaction.fromSerializedTx(txBuffer, { common })
          : FeeMarketEIP1559Transaction.fromSerializedTx(txBuffer);
        return tx.getSenderAddress().toString();
      } catch (e) {
        // If EIP-1559 fails, try legacy (shouldn't happen, but be safe)
        const common = chainId 
          ? Common.custom({ chainId, networkId: chainId }, { hardfork: 'merge' })
          : undefined;
        const tx = common
          ? Transaction.fromSerializedTx(txBuffer, { common })
          : Transaction.fromSerializedTx(txBuffer);
        return tx.getSenderAddress().toString();
      }
    } else {
      // Legacy transaction
      const common = chainId 
        ? Common.custom({ chainId, networkId: chainId }, { hardfork: 'merge' })
        : undefined;
      const tx = common
        ? Transaction.fromSerializedTx(txBuffer, { common })
        : Transaction.fromSerializedTx(txBuffer);
      return tx.getSenderAddress().toString();
    }
  } catch (error) {
    // If decoding fails, return undefined
    return undefined;
  }
}

/**
 * Gets explorer URL for a transaction
 */
function getExplorerUrl(chainId?: number, txHash?: string): string {
  if (!chainId || !txHash) return 'N/A';
  
  const explorerBase = EXPLORER_URLS[chainId];
  return explorerBase ? `${explorerBase}${txHash}` : `Chain ID ${chainId} (no explorer configured)`;
}

