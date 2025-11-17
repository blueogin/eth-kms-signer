#!/usr/bin/env node

/**
 * CLI: Sign Ethereum transactions with AWS KMS
 * Unified command for native ETH transfers, contract calls, and message signing
 */

import { signTransaction, signMessage, getEthereumAddress, getPublicKey } from '../core/signing';
import { submitTransaction } from '../core/submit';
import Web3 from 'web3';
import { AbiItem } from 'web3-utils';
import * as dotenv from 'dotenv';

dotenv.config();

interface TransactionOptions {
  keyId: string;
  to?: string;
  value?: string;
  data?: string;
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
      `  npm run sign -- <KEY_ID> call <CONTRACT> "<FUNCTION>" [PARAMS...] --value 0.1 --chain-id 1`;
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
 * Parses command line arguments
 */
function parseArguments(): { command: string; options: TransactionOptions; autoDetected: boolean } {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    printUsage();
    process.exit(1);
  }
  
  const keyId = process.env.KMS_KEY_ID || args[0];
  const command = args[1] || 'transfer';
  
  const options: TransactionOptions = {
    keyId,
  };
  
  let autoDetected = false;
  
  if (command === 'address' || command === 'publickey' || command === 'public-key' || command === 'pubkey') {
    // Simple commands that don't need additional parsing
    return { command, options, autoDetected };
  }
  
  if (command === 'message') {
    // Message signing
    const message = args[2] || 'Hello, Ethereum!';
    (options as any).message = message;
    return { command, options, autoDetected };
  }
  
  if (command === 'transfer') {
    // Native ETH transfer: sign <KEY_ID> transfer <TO> [VALUE] [CHAIN_ID] [OPTIONS]
    if (args.length < 3) {
      console.error('Error: Transfer command requires a recipient address');
      printUsage();
      process.exit(1);
    }
    
    options.to = args[2];
    options.value = args[3] || '0';
    options.chainId = args[4] ? parseInt(args[4]) : undefined;
    
    // Parse options starting from index 5
    let i = 5;
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
  } else if (command === 'call') {
    // Contract call: sign <KEY_ID> call <CONTRACT> "<FUNCTION>" [PARAMS...] [OPTIONS]
    if (args.length < 4) {
      console.error('Error: Call command requires contract address and function signature');
      printUsage();
      process.exit(1);
    }
    
    const contractAddress = args[2];
    const functionSignature = args[3];
    
    options.to = contractAddress;
    
    // Parse parameters (everything after function signature until we hit an option)
    const potentialParams: string[] = [];
    let i = 4;
    while (i < args.length && !args[i].startsWith('--')) {
      potentialParams.push(args[i]);
      i++;
    }
    
    // Parse function signature to know expected parameter count
    const paramsString = functionSignature.substring(
      functionSignature.indexOf('(') + 1,
      functionSignature.lastIndexOf(')')
    );
    const expectedParamCount = paramsString.trim() 
      ? paramsString.split(',').map(t => t.trim()).filter(t => t.length > 0).length
      : 0;
    
    const parameters: any[] = [];
    const detectedOptions: { value?: string; chainId?: number } = {};
    
    // If we have more potential params than expected, some might be option values
    if (potentialParams.length > expectedParamCount) {
      for (let j = 0; j < potentialParams.length; j++) {
        const param = potentialParams[j];
        const looksLikeValue = /^0\.\d+$/.test(param);
        const looksLikeChainId = /^\d{1,5}$/.test(param) && parseInt(param) > 1000;
        
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
            // Unknown, treat as parameter anyway
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
    
    // Encode function call
    try {
      options.data = encodeFunctionCall(functionSignature, parameters);
      (options as any).functionSignature = functionSignature;
      (options as any).parameters = parameters;
    } catch (error: any) {
      console.error(`Error encoding function call: ${error.message}`);
      process.exit(1);
    }
    
    // Apply detected options
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
    
    autoDetected = !!(detectedOptions.value || detectedOptions.chainId);
  } else {
    // Legacy: treat as simple transfer for backward compatibility
    // sign <KEY_ID> <TO> [VALUE] [CHAIN_ID] [OPTIONS]
    options.to = command;
    options.value = args[2] || '0';
    options.chainId = args[3] ? parseInt(args[3]) : undefined;
    
    // Parse options starting from index 4 (after KEY_ID, TO, VALUE, CHAIN_ID)
    let i = 4;
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
        // If it's a number and we haven't set chainId yet, treat it as chainId
        if (!isNaN(Number(arg)) && options.chainId === undefined) {
          options.chainId = parseInt(arg);
        } else {
          console.error(`Error: Unknown option: ${arg}`);
          printUsage();
          process.exit(1);
        }
      }
      i++;
    }
    
    return { command: 'transfer', options, autoDetected };
  }
  
  // Set defaults
  options.chainId = options.chainId || parseInt(process.env.CHAIN_ID || '84532');
  options.rpcUrl = options.rpcUrl || process.env.RPC_URL;
  
  return { command, options, autoDetected };
}

function printUsage(): void {
  console.error('\nUsage:');
  console.error('  npm run sign -- <KEY_ID> <COMMAND> [ARGS...] [OPTIONS]');
  console.error('  # Note: Use -- to separate npm arguments from script arguments');
  console.error('\nCommands:');
  console.error('  transfer <TO> [VALUE] [CHAIN_ID]     Sign a native ETH transfer');
  console.error('  call <CONTRACT> "<FUNCTION>" [PARAMS] Sign a contract call');
  console.error('  message "MESSAGE"                    Sign a message (EIP-191)');
  console.error('  address                              Get Ethereum address from KMS key');
  console.error('  publickey                            Get public key from KMS key');
  console.error('\nExamples:');
  console.error('  # Native ETH transfer');
  console.error('  npm run sign -- alias/my-key transfer 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb 0.001 1');
  console.error('  npm run sign -- alias/my-key transfer 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb 0.001 --submit --wait');
  console.error('');
  console.error('  # Contract call (ERC20 transfer)');
  console.error('  npm run sign -- alias/my-key call 0xToken... "transfer(address,uint256)" 0xRecipient... 1000000000000000000');
  console.error('');
  console.error('  # Contract call with value');
  console.error('  npm run sign -- alias/my-key call 0xContract... "deposit()" --value 0.1 --chain-id 1');
  console.error('');
  console.error('  # Sign and submit contract call');
  console.error('  npm run sign -- alias/my-key call 0xContract... "approve(address,uint256)" 0xSpender... 1000 --submit --wait');
  console.error('');
  console.error('  # Sign message');
  console.error('  npm run sign -- alias/my-key message "Hello, Ethereum!"');
  console.error('');
  console.error('  # Get address');
  console.error('  npm run sign -- alias/my-key address');
  console.error('');
  console.error('  # Legacy format (backward compatible)');
  console.error('  npm run sign -- alias/my-key 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb 0.001 1');
  console.error('');
  console.error('Options:');
  console.error('  --chain-id, -c <ID>          Chain ID (default: 84532 or from env)');
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
  const region = process.env.AWS_REGION || 'us-east-1';
  const { command, options, autoDetected } = parseArguments();
  
  console.log('=== Sign Ethereum Transaction with AWS KMS ===\n');
  console.log(`Key ID: ${options.keyId}`);
  console.log('Using ECC_SECG_P256K1 (secp256k1) - Native Ethereum support!\n');
  
  if (autoDetected) {
    console.log('⚠️  Warning: Detected option values that were passed without flags.');
    console.log('   This happens when you forget to use "--" before options.');
    console.log('   Tip: Use "npm run sign -- ..." to avoid this warning.\n');
  }
  
  try {
    if (command === 'address') {
      const address = await getEthereumAddress(options.keyId, region);
      console.log(`Ethereum Address: ${address}`);
      return;
    }
    
    if (command === 'publickey' || command === 'public-key' || command === 'pubkey') {
      const publicKey = await getPublicKey(options.keyId, region);
      console.log(`Public Key (uncompressed): ${publicKey}`);
      console.log(`\nPublic Key Details:`);
      console.log(`  Format: Uncompressed (0x04 prefix)`);
      console.log(`  Length: ${publicKey.length - 2} hex characters (${(publicKey.length - 2) / 2} bytes)`);
      console.log(`  Curve: secp256k1 (ECC_SECG_P256K1)`);
      return;
    }
    
    if (command === 'message') {
      const message = (options as any).message || 'Hello, Ethereum!';
      const signature = await signMessage(options.keyId, message, region);
      console.log(`Message: "${message}"`);
      console.log(`Signature: ${signature}`);
      return;
    }
    
    // Transaction signing (transfer or call)
    const address = await getEthereumAddress(options.keyId, region);
    console.log(`Wallet Address: ${address}\n`);
    
    if (command === 'call') {
      const functionSignature = (options as any).functionSignature;
      const parameters = (options as any).parameters;
      console.log(`Contract: ${options.to}`);
      console.log(`Function: ${functionSignature}`);
      console.log(`Parameters: ${JSON.stringify(parameters)}`);
      if (options.value) {
        console.log(`Value: ${options.value} ETH`);
      }
      console.log(`Calldata: ${options.data}\n`);
    } else {
      console.log('Transaction:');
      console.log(`  To: ${options.to}`);
      if (options.value) {
        console.log(`  Value: ${options.value} ETH`);
      }
    }
    
    console.log(`  Chain ID: ${options.chainId}`);
    if (options.rpcUrl) {
      console.log(`  RPC URL: ${options.rpcUrl}`);
    }
    
    if (!options.gasLimit || !options.nonce) {
      console.log('\n⏳ Estimating gas and fetching fee data...');
    }
    
    const transaction = {
      to: options.to!,
      value: options.value,
      data: options.data,
      chainId: options.chainId,
      rpcUrl: options.rpcUrl,
      nonce: options.nonce,
      gasLimit: options.gasLimit,
      gasPrice: options.gasPrice,
      maxFeePerGas: options.maxFeePerGas,
      maxPriorityFeePerGas: options.maxPriorityFeePerGas,
    };
    
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
