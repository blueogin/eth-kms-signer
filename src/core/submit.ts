/**
 * Submit signed Ethereum transactions to blockchain
 */

import { ethers } from 'ethers';
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
  
  // Create provider
  const provider = new ethers.JsonRpcProvider(providerUrl);
  
  try {
    // Send transaction
    const txResponse = await provider.broadcastTransaction(signedTransaction);
    
    console.log(`\n✓ Transaction submitted successfully!`);
    console.log(`  Transaction Hash: ${txResponse.hash}`);
    console.log(`  Explorer: ${getExplorerUrl(chainId, txResponse.hash)}`);
    
    if (waitForConfirmation) {
      console.log(`\n⏳ Waiting for confirmation...`);
      const receipt = await txResponse.wait();
      
      if (!receipt) {
        throw new Error('Transaction receipt is null');
      }
      
      // Handle confirmations (can be a number or a function)
      let confirmations: number = 0;
      const conf = receipt.confirmations;
      if (typeof conf === 'function') {
        confirmations = await conf();
      } else if (typeof conf === 'number') {
        confirmations = conf;
      }
      
      return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        confirmations: confirmations,
        status: receipt.status ?? undefined,
      };
    }
    
    return {
      txHash: txResponse.hash,
    };
  } catch (error: any) {
    if (error.reason) {
      throw new Error(`Transaction failed: ${error.reason}`);
    } else if (error.message) {
      throw new Error(`Transaction failed: ${error.message}`);
    } else {
      throw new Error(`Transaction failed: ${error}`);
    }
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

