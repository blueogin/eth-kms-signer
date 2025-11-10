#!/usr/bin/env node

/**
 * CLI: Sign Ethereum transactions with AWS KMS
 */

import { signTransaction, signMessage, getEthereumAddress, getPublicKey } from '../core/signing';

async function main() {
  const keyId = process.env.KMS_KEY_ID || process.argv[2];
  const command = process.argv[3] || 'transaction';
  const region = process.env.AWS_REGION || 'us-east-1';
  
  if (!keyId) {
    console.error('Error: KMS Key ID is required');
    console.error('Usage: npm run sign <KEY_ID> [command]');
    console.error('Commands: transaction, message, address, publickey');
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
    } else if (command === 'publickey' || command === 'public-key' || command === 'pubkey') {
      const publicKey = await getPublicKey(keyId, region);
      console.log(`Public Key (uncompressed): ${publicKey}`);
      console.log(`\nPublic Key Details:`);
      console.log(`  Format: Uncompressed (0x04 prefix)`);
      console.log(`  Length: ${publicKey.length - 2} hex characters (${(publicKey.length - 2) / 2} bytes)`);
      console.log(`  Curve: secp256k1 (ECC_SECG_P256K1)`);
    } else if (command === 'message') {
      const message = process.argv[4] || 'Hello, Ethereum!';
      const signature = await signMessage(keyId, message, region);
      console.log(`Message: "${message}"`);
      console.log(`Signature: ${signature}`);
    } else {
      const transaction = {
        to: process.argv[4] || '0x6608BED41902ca642bef6840Ae3Fb94ca76083a8',
        value: process.argv[5] || '0.00001',
        chainId: parseInt(process.argv[6] || '84532'),
        rpcUrl: process.env.RPC_URL, // Use RPC URL from env for gas estimation
      };
      
      const address = await getEthereumAddress(keyId, region);
      console.log(`Wallet Address: ${address}`);
      console.log('\nTransaction:');
      console.log(`  To: ${transaction.to}`);
      console.log(`  Value: ${transaction.value} ETH`);
      console.log(`  Chain ID: ${transaction.chainId}`);
      if (transaction.rpcUrl) {
        console.log(`  RPC URL: ${transaction.rpcUrl}`);
      }
      console.log('\n⏳ Estimating gas and fetching fee data...');
      
      const signedTx = await signTransaction(keyId, transaction, region);
      console.log(`\n✓ Transaction signed successfully`);
      console.log(`Signed Transaction: ${signedTx}`);
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

