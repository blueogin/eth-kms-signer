#!/usr/bin/env node

/**
 * CLI: Setup AWS KMS key for Ethereum signing
 */

import { createKMSKey } from '../core/setup';

async function main() {
  const aliasName = process.argv[2] || 'ethereum-signing-key';
  const region = process.env.AWS_REGION || 'us-east-1';
  
  console.log('=== AWS KMS Setup for Ethereum Signing ===\n');
  console.log(`Region: ${region}`);
  console.log(`Alias: ${aliasName}\n`);

  try {
    const result = await createKMSKey(aliasName, region);
    
    console.log('✓ KMS key created:', result.keyId);
    console.log('  ARN:', result.keyArn);
    if (result.aliasName.startsWith('alias/')) {
      console.log('  Alias:', result.aliasName);
    } else {
      console.log('  Note: No alias created (using key ID directly)');
    }
    console.log('\n✅ Native Ethereum Support Enabled!');
    console.log('   KMS key uses ECC_SECG_P256K1 (secp256k1) - Ethereum\'s curve');
    console.log('   You can now sign Ethereum transactions directly in KMS!');
    console.log('\nNext steps:');
    console.log('1. Update your .env file with:');
    console.log(`   KMS_KEY_ID=${result.keyId}`);
    console.log(`   KMS_KEY_ARN=${result.keyArn}`);
    console.log('2. Run: npm run sign');
  } catch (error: any) {
    console.error('\nSetup failed:', error.message);
    process.exit(1);
  }
}

main();

