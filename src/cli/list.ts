#!/usr/bin/env node

/**
 * CLI: List all KMS keys
 */

import { listKMSKeys, KeyInfo } from '../core/list';

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

function formatTable(keys: KeyInfo[], includeDetails: boolean): void {
  if (keys.length === 0) {
    console.log('No KMS keys found in this region.');
    return;
  }

  if (!includeDetails) {
    // Simple table format
    console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ Key ID                                                          │ Alias      │');
    console.log('├─────────────────────────────────────────────────────────────────────────────┤');
    
    keys.forEach((key) => {
      const keyId = truncate(key.keyId, 60);
      const alias = key.alias ? truncate(key.alias.replace('alias/', ''), 10) : '-';
      console.log(`│ ${keyId.padEnd(60)} │ ${alias.padEnd(10)} │`);
    });
    
    console.log('└─────────────────────────────────────────────────────────────────────────────┘');
    return;
  }

  // Detailed table format
  const rows: string[][] = [];
  
  keys.forEach((key) => {
    const keyId = truncate(key.keyId, 30);
    const alias = key.alias ? truncate(key.alias.replace('alias/', ''), 20) : '-';
    const keySpec = key.keySpec || '-';
    const keySpecDisplay = keySpec === 'ECC_SECG_P256K1' ? '✓ secp256k1' : keySpec;
    const state = key.enabled ? '✓ Enabled' : '✗ Disabled';
    const created = key.creationDate 
      ? key.creationDate.toISOString().split('T')[0] 
      : '-';
    const description = key.description ? truncate(key.description, 30) : '-';
    
    rows.push([keyId, alias, keySpecDisplay, state, created, description]);
  });

  // Calculate column widths
  const headers = ['Key ID', 'Alias', 'Key Spec', 'State', 'Created', 'Description'];
  const colWidths = headers.map((header, i) => {
    const maxContentWidth = Math.max(
      header.length,
      ...rows.map(row => row[i].length)
    );
    return Math.min(maxContentWidth + 2, i === 0 ? 32 : i === 1 ? 22 : i === 2 ? 15 : i === 3 ? 12 : i === 4 ? 12 : 32);
  });

  // Print table header
  const topBorder = '┌' + colWidths.map(w => '─'.repeat(w)).join('┬') + '┐';
  const headerRow = '│' + headers.map((h, i) => ` ${h.padEnd(colWidths[i] - 1)}`).join('│') + '│';
  const separator = '├' + colWidths.map(w => '─'.repeat(w)).join('┼') + '┤';
  const bottomBorder = '└' + colWidths.map(w => '─'.repeat(w)).join('┴') + '┘';

  console.log(topBorder);
  console.log(headerRow);
  console.log(separator);

  // Print data rows
  rows.forEach((row) => {
    const rowStr = '│' + row.map((cell, i) => ` ${cell.padEnd(colWidths[i] - 1)}`).join('│') + '│';
    console.log(rowStr);
  });

  console.log(bottomBorder);
}

async function main() {
  const region = process.env.AWS_REGION || 'us-east-1';
  const includeDetails = process.argv[2] !== '--simple';
  
  console.log('=== AWS KMS Keys ===\n');
  console.log(`Region: ${region}\n`);

  try {
    const keys = await listKMSKeys(region, includeDetails);
    
    formatTable(keys, includeDetails);

    // Summary
    if (includeDetails && keys.length > 0) {
      const ethereumKeys = keys.filter(k => k.keySpec === 'ECC_SECG_P256K1');
      const enabledKeys = keys.filter(k => k.enabled);
      
      console.log('\nSummary:');
      console.log(`  Total keys: ${keys.length}`);
      console.log(`  Ethereum-compatible (secp256k1): ${ethereumKeys.length}`);
      console.log(`  Enabled: ${enabledKeys.length}`);
      console.log(`  Disabled: ${keys.length - enabledKeys.length}`);
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

