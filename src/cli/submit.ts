#!/usr/bin/env node

/**
 * CLI: Submit signed Ethereum transactions to blockchain
 */

import { submitTransaction, getSignerAddress } from '../core/submit';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  const signedTx = process.argv[2];
  const rpcUrl = process.argv[3] || process.env.RPC_URL;
  const chainId = process.argv[4] ? parseInt(process.argv[4]) : undefined;
  const waitForConfirmation = process.argv.includes('--wait') || process.argv.includes('-w');
  
  if (!signedTx) {
    console.error('Error: Signed transaction is required');
    console.error('\nUsage:');
    console.error('  npm run submit <SIGNED_TX> [RPC_URL] [CHAIN_ID] [--wait]');
    console.error('\nExamples:');
    console.error('  npm run submit 0x02f869... https://sepolia.base.org 84532');
    console.error('  npm run submit 0x02f869... --wait  # Uses default RPC from chain ID');
    console.error('  npm run submit 0x02f869... https://custom-rpc.com  # Custom RPC');
    console.error('\nOptions:');
    console.error('  --wait, -w    Wait for transaction confirmation');
    console.error('\nEnvironment Variables:');
    console.error('  RPC_URL       Default RPC URL (optional)');
    process.exit(1);
  }
  
  console.log('=== Submit Ethereum Transaction ===\n');
  
  // Extract and display signer address before submitting
  const signerAddress = getSignerAddress(signedTx, chainId);
  if (signerAddress) {
    console.log(`Signer Address: ${signerAddress}`);
  }
  
  if (rpcUrl) {
    console.log(`RPC URL: ${rpcUrl}`);
  }
  if (chainId) {
    console.log(`Chain ID: ${chainId}`);
  }
  if (waitForConfirmation) {
    console.log('Waiting for confirmation: Yes');
  }
  console.log('');
  
  try {
    const result = await submitTransaction({
      signedTransaction: signedTx,
      rpcUrl: rpcUrl,
      chainId: chainId,
      waitForConfirmation: waitForConfirmation,
    });
    
    if (result.blockNumber) {
      console.log(`\n✅ Transaction confirmed!`);
      console.log(`  Block Number: ${result.blockNumber}`);
      console.log(`  Confirmations: ${result.confirmations}`);
      console.log(`  Status: ${result.status === 1 ? 'Success' : 'Failed'}`);
    } else {
      console.log(`\n✅ Transaction submitted! Check explorer for status.`);
    }
  } catch (error: any) {
    console.error('\n❌ Error:', error.message || error);
    if (error.stack && process.env.DEBUG) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

main();

