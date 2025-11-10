/**
 * Shared constants for the KMS Ethereum Signing library
 */

// Common RPC endpoints for different chains
export const CHAIN_RPC_URLS: Record<number, string> = {
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

// Blockchain explorer URLs
export const EXPLORER_URLS: Record<number, string> = {
  1: 'https://etherscan.io/tx/',
  5: 'https://goerli.etherscan.io/tx/',
  11155111: 'https://sepolia.etherscan.io/tx/',
  137: 'https://polygonscan.com/tx/',
  80001: 'https://mumbai.polygonscan.com/tx/',
  56: 'https://bscscan.com/tx/',
  97: 'https://testnet.bscscan.com/tx/',
  43114: 'https://snowtrace.io/tx/',
  43113: 'https://testnet.snowtrace.io/tx/',
  250: 'https://ftmscan.com/tx/',
  42161: 'https://arbiscan.io/tx/',
  421611: 'https://testnet.arbiscan.io/tx/',
  10: 'https://optimistic.etherscan.io/tx/',
  8453: 'https://basescan.org/tx/',
  84532: 'https://sepolia.basescan.org/tx/',
};

