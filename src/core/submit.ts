/**
 * Submit signed Ethereum transactions to blockchain
 */

import { ethers } from 'ethers';

// Common RPC endpoints for different chains
const CHAIN_RPC_URLS: Record<number, string> = {
  // Mainnets
  1: 'https://eth.llamarpc.com', // Ethereum Mainnet
  137: 'https://polygon-rpc.com', // Polygon
  56: 'https://bsc-dataseed.binance.org/', // BSC
  43114: 'https://api.avax.network/ext/bc/C/rpc', // Avalanche
  250: 'https://rpc.ftm.tools/', // Fantom
  42161: 'https://arb1.arbitrum.io/rpc', // Arbitrum One
  10: 'https://mainnet.optimism.io', // Optimism
  8453: 'https://mainnet.base.org', // Base
  
  // Testnets
  5: 'https://goerli.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161', // Goerli
  11155111: 'https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161', // Sepolia
  80001: 'https://rpc-mumbai.maticvigil.com', // Mumbai (Polygon testnet)
  97: 'https://data-seed-prebsc-1-s1.binance.org:8545', // BSC Testnet
  43113: 'https://api.avax-test.network/ext/bc/C/rpc', // Avalanche Fuji
  421611: 'https://rinkeby.arbitrum.io/rpc', // Arbitrum Rinkeby
  84532: 'https://sepolia.base.org', // Base Sepolia
};

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
  
  const explorers: Record<number, string> = {
    1: `https://etherscan.io/tx/${txHash}`,
    5: `https://goerli.etherscan.io/tx/${txHash}`,
    11155111: `https://sepolia.etherscan.io/tx/${txHash}`,
    137: `https://polygonscan.com/tx/${txHash}`,
    80001: `https://mumbai.polygonscan.com/tx/${txHash}`,
    56: `https://bscscan.com/tx/${txHash}`,
    97: `https://testnet.bscscan.com/tx/${txHash}`,
    43114: `https://snowtrace.io/tx/${txHash}`,
    43113: `https://testnet.snowtrace.io/tx/${txHash}`,
    250: `https://ftmscan.com/tx/${txHash}`,
    42161: `https://arbiscan.io/tx/${txHash}`,
    421611: `https://testnet.arbiscan.io/tx/${txHash}`,
    10: `https://optimistic.etherscan.io/tx/${txHash}`,
    8453: `https://basescan.org/tx/${txHash}`,
    84532: `https://sepolia.basescan.org/tx/${txHash}`,
  };
  
  return explorers[chainId] || `Chain ID ${chainId} (no explorer configured)`;
}

