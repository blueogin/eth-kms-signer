#!/usr/bin/env node

/**
 * CLI: Sign Ethereum contract call transactions with AWS KMS
 */

import { signTransaction, getEthereumAddress } from '../core/signing';
import { submitTransaction } from '../core/submit';
import Web3 from 'web3';
import { AbiItem } from 'web3-utils';
import * as dotenv from 'dotenv';

dotenv.config();

interface ContractCallOptions {
  keyId: string;
  contractAddress: string;
  functionSignature: string;
  parameters: any[];
  value?: string;
  chainId?: number;
  rpcUrl?: string;
  nonce?: number;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  submit?: boolean;
  waitForConfirmation?: boolean;
}

/**
 * Encodes a function call with its parameters
 */
function encodeFunctionCall(functionSignature: string, parameters: any[]): string {
  const web3 = new Web3();
  
  // Parse function signature (e.g., "transfer(address,uint256)")
  const functionName = functionSignature.split('(')[0];
  const paramsString = functionSignature.substring(
    functionSignature.indexOf('(') + 1,
    functionSignature.lastIndexOf(')')
  );
  // Split by comma and filter out empty strings, then trim each type
  const paramTypes = paramsString.trim() 
    ? paramsString.split(',').map(t => t.trim()).filter(t => t.length > 0)
    : [];
  
  // Validate parameter count matches
  if (paramTypes.length !== parameters.length) {
    const errorMsg = `Parameter count mismatch: function "${functionName}" expects ${paramTypes.length} parameter(s), but ${parameters.length} were provided.\n` +
      `  Function signature: ${functionSignature}\n` +
      
      `  Provided parameters: ${JSON.stringify(parameters)}\n` +
      `\nTip: If you're using options like --value or --chain-id, make sure to use "--" before them:\n` +
      `  npm run call -- <KEY_ID> <CONTRACT> "<FUNCTION>" [PARAMS...] --value 0.1 --chain-id 1`;
    throw new Error(errorMsg);
  }
  
  // Create function ABI
  const functionAbi: AbiItem = {
    name: functionName,
    type: 'function',
    inputs: paramTypes.map((type, index) => ({
      name: `param${index}`,
      type: type,
    })),
  } as AbiItem;
  
  // Encode function call
  return web3.eth.abi.encodeFunctionCall(functionAbi, parameters);
}

/**
 * Parses command line arguments for contract call
 */
function parseArguments(): { options: ContractCallOptions; autoDetected: boolean } {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.error('Error: Insufficient arguments');
    printUsage();
    process.exit(1);
  }
  
  const keyId = process.env.KMS_KEY_ID || args[0];
  const contractAddress = args[1];
  const functionSignature = args[2];
  
  // Parse parameters (everything after function signature until we hit an option)
  // First, collect all potential parameters
  const potentialParams: string[] = [];
  let i = 3;
  while (i < args.length && !args[i].startsWith('--')) {
    potentialParams.push(args[i]);
    i++;
  }
  
  // Now check if any of these look like option values that were misplaced
  // (This happens when user forgets to use -- and npm consumes the option flags)
  const parameters: any[] = [];
  const detectedOptions: { value?: string; chainId?: number } = {};
  
  // Parse function signature to know expected parameter count
  const paramsString = functionSignature.substring(
    functionSignature.indexOf('(') + 1,
    functionSignature.lastIndexOf(')')
  );
  const expectedParamCount = paramsString.trim() 
    ? paramsString.split(',').map(t => t.trim()).filter(t => t.length > 0).length
    : 0;
  
  // If we have more potential params than expected, some might be option values
  if (potentialParams.length > expectedParamCount) {
    // Check each potential param to see if it looks like an option value
    for (let j = 0; j < potentialParams.length; j++) {
      const param = potentialParams[j];
      const looksLikeValue = /^0\.\d+$/.test(param); // Matches 0.00001, 0.1, etc.
      const looksLikeChainId = /^\d{1,5}$/.test(param) && parseInt(param) > 1000; // Matches chain IDs
      
      // If we still need parameters, treat it as a parameter
      // Otherwise, treat it as an option value
      if (parameters.length < expectedParamCount) {
        // Parse as parameter
        let parsedParam: any = param;
        if (parsedParam === 'true' || parsedParam === 'false') {
          parsedParam = parsedParam === 'true';
        } else if (!isNaN(Number(parsedParam)) && parsedParam.trim() !== '' && !parsedParam.startsWith('0x')) {
          parsedParam = Number(parsedParam);
        }
        parameters.push(parsedParam);
      } else {
        // This is likely an option value
        if (looksLikeValue && !detectedOptions.value) {
          detectedOptions.value = param;
        } else if (looksLikeChainId && !detectedOptions.chainId) {
          detectedOptions.chainId = parseInt(param);
        } else {
          // Unknown, treat as parameter anyway (will cause validation error)
          let parsedParam: any = param;
          if (parsedParam === 'true' || parsedParam === 'false') {
            parsedParam = parsedParam === 'true';
          } else if (!isNaN(Number(parsedParam)) && parsedParam.trim() !== '' && !parsedParam.startsWith('0x')) {
            parsedParam = Number(parsedParam);
          }
          parameters.push(parsedParam);
        }
      }
    }
  } else {
    // Normal case: parse all as parameters
    for (const param of potentialParams) {
      let parsedParam: any = param;
      if (parsedParam === 'true' || parsedParam === 'false') {
        parsedParam = parsedParam === 'true';
      } else if (!isNaN(Number(parsedParam)) && parsedParam.trim() !== '' && !parsedParam.startsWith('0x')) {
        parsedParam = Number(parsedParam);
      }
      parameters.push(parsedParam);
    }
  }
  
  // Parse options
  const options: ContractCallOptions = {
    keyId,
    contractAddress,
    functionSignature,
    parameters,
  };
  
  // Apply detected options (from misplaced values)
  if (detectedOptions.value) {
    options.value = detectedOptions.value;
  }
  if (detectedOptions.chainId) {
    options.chainId = detectedOptions.chainId;
  }
  
  // Parse remaining flags
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--chain-id' || arg === '-c') {
      options.chainId = parseInt(args[++i]);
    } else if (arg === '--rpc-url' || arg === '-r') {
      options.rpcUrl = args[++i];
    } else if (arg === '--value' || arg === '-v') {
      options.value = args[++i];
    } else if (arg === '--nonce' || arg === '-n') {
      options.nonce = parseInt(args[++i]);
    } else if (arg === '--gas-limit' || arg === '-g') {
      options.gasLimit = args[++i];
    } else if (arg === '--gas-price') {
      options.gasPrice = args[++i];
    } else if (arg === '--max-fee-per-gas') {
      options.maxFeePerGas = args[++i];
    } else if (arg === '--max-priority-fee-per-gas') {
      options.maxPriorityFeePerGas = args[++i];
    } else if (arg === '--submit' || arg === '-s') {
      options.submit = true;
    } else if (arg === '--wait' || arg === '-w') {
      options.waitForConfirmation = true;
    } else {
      console.error(`Error: Unknown option: ${arg}`);
      printUsage();
      process.exit(1);
    }
    i++;
  }
  
  // Set defaults
  const region = process.env.AWS_REGION || 'us-east-1';
  options.chainId = options.chainId || parseInt('84532');
  options.rpcUrl = options.rpcUrl || process.env.RPC_URL;
  
  const autoDetected = !!(detectedOptions.value || detectedOptions.chainId);
  
  return { options, autoDetected };
}

function printUsage(): void {
  console.error('\nUsage:');
  console.error('  npm run call -- <KEY_ID> <CONTRACT_ADDRESS> "<FUNCTION_SIGNATURE>" [PARAMS...] [OPTIONS]');
  console.error('  # Note: Use -- to separate npm arguments from script arguments');
  console.error('\nExamples:');
  console.error('  # ERC20 transfer');
  console.error('  npm run call -- alias/my-key 0xToken... "transfer(address,uint256)" 0xRecipient... 1000000000000000000');
  console.error('');
  console.error('  # With value (ETH) - note: quote function signature with parentheses');
  console.error('  npm run call -- alias/my-key 0xContract... "deposit()" --value 0.1 --chain-id 1');
  console.error('');
  console.error('  # Sign and submit');
  console.error('  npm run call -- alias/my-key 0xContract... "approve(address,uint256)" 0xSpender... 1000 --submit --wait');
  console.error('');
  console.error('  # With custom gas');
  console.error('  npm run call -- alias/my-key 0xContract... "transfer(address,uint256)" 0xRecipient... 1000 --gas-limit 65000 --gas-price 20000000000');
  console.error('');
  console.error('Options:');
  console.error('  --chain-id, -c <ID>          Chain ID (default: 84532)');
  console.error('  --rpc-url, -r <URL>          RPC URL for gas estimation');
  console.error('  --value, -v <AMOUNT>         ETH value to send (in ETH, e.g., 0.1)');
  console.error('  --nonce, -n <NONCE>          Transaction nonce (auto-fetched if not provided)');
  console.error('  --gas-limit, -g <LIMIT>      Gas limit (auto-estimated if not provided)');
  console.error('  --gas-price <PRICE>          Gas price in wei (legacy transactions)');
  console.error('  --max-fee-per-gas <FEE>      Max fee per gas (EIP-1559)');
  console.error('  --max-priority-fee-per-gas   Max priority fee per gas (EIP-1559)');
  console.error('  --submit, -s                 Submit transaction after signing');
  console.error('  --wait, -w                   Wait for transaction confirmation (requires --submit)');
  console.error('\nEnvironment Variables:');
  console.error('  KMS_KEY_ID                   Default KMS key ID');
  console.error('  AWS_REGION                   AWS region (default: us-east-1)');
  console.error('  RPC_URL                      Default RPC URL');
  console.error('  CHAIN_ID                     Default chain ID');
}

async function main() {
  const { options, autoDetected } = parseArguments();
  const region = process.env.AWS_REGION || 'us-east-1';
  
  console.log('=== Sign Ethereum Contract Call with AWS KMS ===\n');
  
  if (autoDetected) {
    console.log('⚠️  Warning: Detected option values that were passed without flags.');
    console.log('   This happens when you forget to use "--" before options.');
    console.log('   Tip: Use "npm run call -- ..." to avoid this warning.\n');
  }
  
  console.log(`Key ID: ${options.keyId}`);
  console.log(`Contract: ${options.contractAddress}`);
  console.log(`Function: ${options.functionSignature}`);
  console.log(`Parameters: ${JSON.stringify(options.parameters)}`);
  if (options.value) {
    console.log(`Value: ${options.value} ETH`);
  }
  console.log(`Chain ID: ${options.chainId}`);
  if (options.rpcUrl) {
    console.log(`RPC URL: ${options.rpcUrl}`);
  }
  console.log('');
  
  try {
    // Get wallet address
    const address = await getEthereumAddress(options.keyId, region);
    console.log(`Wallet Address: ${address}\n`);
    
    // Encode function call
    console.log('⏳ Encoding function call...');
    const calldata = encodeFunctionCall(options.functionSignature, options.parameters);
    console.log(`Calldata: ${calldata}\n`);
    
    // Build transaction
    const transaction = {
      to: options.contractAddress,
      data: calldata,
      value: options.value,
      chainId: options.chainId,
      rpcUrl: options.rpcUrl,
      nonce: options.nonce,
      gasLimit: options.gasLimit,
      gasPrice: options.gasPrice,
      maxFeePerGas: options.maxFeePerGas,
      maxPriorityFeePerGas: options.maxPriorityFeePerGas,
    };
    
    if (!options.gasLimit || !options.nonce) {
      console.log('⏳ Estimating gas and fetching fee data...');
    }
    
    // Sign transaction
    const signedTx = await signTransaction(options.keyId, transaction, region);
    console.log(`\n✓ Transaction signed successfully`);
    console.log(`Signed Transaction: ${signedTx}\n`);
    
    // Submit if requested
    if (options.submit) {
      console.log('⏳ Submitting transaction to blockchain...');
      const result = await submitTransaction({
        signedTransaction: signedTx,
        rpcUrl: options.rpcUrl,
        chainId: options.chainId,
        waitForConfirmation: options.waitForConfirmation,
      });
      
      if (result.blockNumber) {
        console.log(`\n✅ Transaction confirmed!`);
        console.log(`  Transaction Hash: ${result.txHash}`);
        console.log(`  Block Number: ${result.blockNumber}`);
        console.log(`  Confirmations: ${result.confirmations}`);
        console.log(`  Status: ${result.status === 1 ? 'Success' : 'Failed'}`);
      } else {
        console.log(`\n✅ Transaction submitted!`);
        console.log(`  Transaction Hash: ${result.txHash}`);
      }
    } else {
      console.log('💡 Tip: Use --submit to submit the transaction, or use:');
      console.log(`   npm run submit ${signedTx} ${options.rpcUrl || ''} ${options.chainId}`);
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

