/**
 * Submit signed Ethereum transactions to blockchain
 */

import Web3 from 'web3';
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
    // Send transaction
    // web3.eth.sendSignedTransaction returns a promise that resolves with the transaction hash
    // We can use the promise API or event handlers
    return new Promise<SubmitResult>((resolve, reject) => {
      web3.eth.sendSignedTransaction(signedTransaction)
        .on('transactionHash', (hash: string) => {
          console.log(`\n✓ Transaction submitted successfully!`);
          console.log(`  Transaction Hash: ${hash}`);
          console.log(`  Explorer: ${getExplorerUrl(chainId, hash)}`);
          
          if (!waitForConfirmation) {
            resolve({
              txHash: hash,
            });
          }
        })
        .on('receipt', (receipt: any) => {
          if (waitForConfirmation) {
            // Get current block number to calculate confirmations
            web3.eth.getBlockNumber()
              .then((currentBlock: number) => {
                const confirmations = receipt.blockNumber ? currentBlock - receipt.blockNumber + 1 : 0;
                resolve({
                  txHash: receipt.transactionHash,
                  blockNumber: receipt.blockNumber,
                  confirmations: confirmations,
                  status: receipt.status !== undefined ? receipt.status : undefined,
                });
              })
              .catch(reject);
          }
        })
        .on('error', (error: any) => {
          const errorMessage = error.reason || error.message || String(error);
          reject(new Error(`Transaction failed: ${errorMessage}`));
        });
    });
  } catch (error: any) {
    const errorMessage = error.reason || error.message || String(error);
    throw new Error(`Transaction failed: ${errorMessage}`);
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

