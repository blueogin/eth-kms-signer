#!/usr/bin/env node

/**
 * CLI: Sign Ethereum transactions with AWS KMS
 */

import { signTransaction, signMessage, getEthereumAddress } from '../core/signing';

async function main() {
  const keyId = process.env.KMS_KEY_ID || process.argv[2];
  const command = process.argv[3] || 'transaction';
  const region = process.env.AWS_REGION || 'us-east-1';
  
  if (!keyId) {
    console.error('Error: KMS Key ID is required');
    console.error('Usage: npm run sign <KEY_ID> [command]');
    console.error('Commands: transaction, message, address');
    console.error('Or set KMS_KEY_ID in .env file');
    process.exit(1);
  }
  
  console.log('=== Sign Ethereum Transaction with AWS KMS ===\n');
  console.log(`Key ID: ${keyId}`);
  console.log('Using ECC_SECG_P256K1 (secp256k1) - Native Ethereum support!\n');
  
  try {
    if (command === 'address') {
      const address = await getEthereumAddress(keyId, region);
      console.log(`Ethereum Address: ${address}`);
    } else if (command === 'message') {
      const message = process.argv[4] || 'Hello, Ethereum!';
      const signature = await signMessage(keyId, message, region);
      console.log(`Message: "${message}"`);
      console.log(`Signature: ${signature}`);
    } else {
      const transaction = {
        to: process.argv[4] || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        value: process.argv[5] || '0.001',
        chainId: parseInt(process.argv[6] || '1'),
      };
      
      const address = await getEthereumAddress(keyId, region);
      console.log(`Wallet Address: ${address}`);
      console.log('\nTransaction:');
      console.log(`  To: ${transaction.to}`);
      console.log(`  Value: ${transaction.value} ETH`);
      console.log(`  Chain ID: ${transaction.chainId}`);
      
      const signedTx = await signTransaction(keyId, transaction, region);
      console.log(`\n✓ Transaction signed successfully`);
      console.log(`Signed Transaction: ${signedTx}`);
    }
  } catch (error: any) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

main();

