#!/usr/bin/env node

/**
 * CLI: Import existing Ethereum private key into AWS KMS
 */

import { importKMSKey } from '../core/setup';
import { getEthereumAddress } from '../core/signing';

async function main() {
  const privateKeyHex = process.argv[2];
  const aliasName = process.argv[3] || 'ethereum-signing-key-imported';
  const region = process.env.AWS_REGION || 'us-east-1';
  
  if (!privateKeyHex) {
    console.error('Usage: npm run import <PRIVATE_KEY_HEX> [ALIAS_NAME]');
    console.error('');
    console.error('Example:');
    console.error('  npm run import 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
    console.error('  npm run import 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef my-key');
    console.error('');
    console.error('Note: The private key can be provided with or without the 0x prefix.');
    process.exit(1);
  }

  console.log('=== Import Ethereum Private Key to AWS KMS ===\n');
  console.log(`Region: ${region}`);
  console.log(`Alias: ${aliasName}\n`);

  try {
    // Show a warning about security
    console.log('⚠️  Security Warning:');
    console.log('   - Your private key will be encrypted and imported into AWS KMS');
    console.log('   - The key material will be stored securely in AWS KMS HSM');
    console.log('   - After import, you can delete the original private key from your system\n');

    const result = await importKMSKey(privateKeyHex, aliasName, region);
    
    console.log('✓ Private key imported successfully!');
    console.log('  Key ID:', result.keyId);
    console.log('  ARN:', result.keyArn);
    if (result.aliasName.startsWith('alias/')) {
      console.log('  Alias:', result.aliasName);
    } else {
      console.log('  Note: No alias created (using key ID directly)');
    }
    
    // Get and display the Ethereum address
    try {
      const address = await getEthereumAddress(result.keyId, region);
      console.log('  Ethereum Address:', address);
    } catch (error: any) {
      console.warn('  Warning: Could not retrieve Ethereum address:', error.message);
    }
    
    console.log('\n✅ Key Import Complete!');
    console.log('   Your private key is now stored securely in AWS KMS');
    console.log('   You can now use this key to sign Ethereum transactions\n');
    console.log('Next steps:');
    console.log('1. Update your .env file with:');
    console.log(`   KMS_KEY_ID=${result.keyId}`);
    console.log(`   KMS_KEY_ARN=${result.keyArn}`);
    console.log('2. Run: npm run sign');
    console.log('\n⚠️  Remember to securely delete the original private key from your system!');
  } catch (error: any) {
    console.error('\nImport failed:', error.message);
    if (error.message.includes('Invalid private key')) {
      console.error('\nMake sure your private key is:');
      console.error('  - 64 hexadecimal characters (32 bytes)');
      console.error('  - Valid hex format (0-9, a-f, A-F)');
    }
    process.exit(1);
  }
}

main();

