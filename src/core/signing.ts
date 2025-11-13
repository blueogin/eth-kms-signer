/**
 * Ethereum Transaction Signing with AWS KMS
 * 
 * Uses KMS ECC_SECG_P256K1 key to sign Ethereum transactions natively.
 * Private key never leaves KMS - signing happens in HSM!
 */

import { SignCommand, GetPublicKeyCommand } from '@aws-sdk/client-kms';
import Web3 from 'web3';
import { Transaction, FeeMarketEIP1559Transaction } from '@ethereumjs/tx';
import { Common } from '@ethereumjs/common';
import { createKMSClient } from './kms-client';
import { CHAIN_RPC_URLS } from './constants';

function getDefaultRpcUrl(chainId?: number): string | undefined {
  return chainId ? CHAIN_RPC_URLS[chainId] : undefined;
}

/**
 * Fetches nonce from network if not provided
 */
async function fetchNonceIfNeeded(
  keyId: string,
  transaction: EthereumTransaction,
  tx: any,
  region?: string
): Promise<void> {
  if (transaction.nonce !== undefined) {
    tx.nonce = transaction.nonce;
    return;
  }

  if (transaction.rpcUrl || transaction.chainId) {
    try {
      const rpcUrl = transaction.rpcUrl || getDefaultRpcUrl(transaction.chainId);
      if (rpcUrl) {
        const web3 = new Web3(rpcUrl);
        const senderAddress = await getEthereumAddress(keyId, region);
        tx.nonce = await web3.eth.getTransactionCount(senderAddress, 'pending');
        return;
      }
    } catch (error: any) {
      console.warn(`Warning: Could not fetch nonce from network: ${error.message}`);
    }
  }
  
  tx.nonce = 0;
}

/**
 * Gets the public key from KMS in hex format
 */
export async function getPublicKey(keyId: string, region?: string): Promise<string> {
  const kmsClient = createKMSClient(region);
  
  try {
    const getPublicKeyCommand = new GetPublicKeyCommand({ KeyId: keyId });
    const response = await kmsClient.send(getPublicKeyCommand);
    
    if (!response.PublicKey) {
      throw new Error('Failed to get public key from KMS');
    }
  
    const publicKeyBytes = Buffer.from(response.PublicKey);
    
    // AWS KMS returns public key in DER format (ASN.1)
    // We need to parse it to extract the raw public key
    // Format: SEQUENCE { AlgorithmIdentifier, BIT STRING { 0x04 [64 bytes] } }
    
    let publicKey: Buffer;
    
    if (publicKeyBytes[0] === 0x04) {
      // Raw format (uncompressed) - first byte is 0x04
      publicKey = publicKeyBytes;
    } else if (publicKeyBytes[0] === 0x30) {
      // DER format - need to parse
      // Look for the bit string (0x03) that contains the public key
      let offset = 0;
      
      // Skip outer SEQUENCE (0x30)
      if (publicKeyBytes[offset] === 0x30) {
        offset += 2; // Skip 0x30 and length byte
        
        // Skip AlgorithmIdentifier (OID for secp256k1)
        // Find the BIT STRING (0x03)
        while (offset < publicKeyBytes.length && publicKeyBytes[offset] !== 0x03) {
          offset++;
        }
        
        if (publicKeyBytes[offset] === 0x03) {
          // Found BIT STRING
          const bitStringLength = publicKeyBytes[offset + 1];
          offset += 2; // Skip 0x03 and length
          
          // The first byte of the bit string is usually 0x00 (unused bits), 
          // followed by 0x04 (uncompressed point), then 64 bytes
          if (publicKeyBytes[offset] === 0x00 && publicKeyBytes[offset + 1] === 0x04) {
            // Extract the public key (0x04 + 64 bytes = 65 bytes)
            publicKey = publicKeyBytes.slice(offset + 1, offset + 66);
          } else if (publicKeyBytes[offset] === 0x04) {
            // No padding byte, 0x04 directly
            publicKey = publicKeyBytes.slice(offset, offset + 65);
          } else {
            throw new Error('Unexpected DER format: could not find public key');
          }
        } else {
          throw new Error('Unexpected DER format: BIT STRING not found');
        }
      } else {
        throw new Error('Unexpected public key format: not raw or DER');
      }
    } else {
      throw new Error(`Unexpected public key format: starts with 0x${publicKeyBytes[0].toString(16)}`);
    }
    
    // Verify it's uncompressed format (starts with 0x04)
    if (publicKey[0] !== 0x04) {
      throw new Error(`Unexpected public key format: expected 0x04, got 0x${publicKey[0].toString(16)}`);
    }
    
    // Return uncompressed public key (0x04 prefix + 64 bytes = 130 hex chars)
    return '0x' + publicKey.toString('hex');
  } catch (error: any) {
    const errorMessage = error.message || error.name || 'Unknown error';
    const errorCode = error.$metadata?.httpStatusCode || error.Code || '';
    throw new Error(`Failed to get public key: ${errorMessage}${errorCode ? ` (Code: ${errorCode})` : ''}`);
  }
}

/**
 * Gets Ethereum address from KMS public key
 */
export async function getEthereumAddress(keyId: string, region?: string): Promise<string> {
  const publicKeyHex = await getPublicKey(keyId, region);
  
  // publicKeyHex is in format: 0x04[64 bytes]
  // Remove 0x prefix and 0x04 prefix to get the 64-byte public key
  const publicKeyBytes = publicKeyHex.slice(4); // Remove '0x04'
  
  // Hash the public key (64 bytes) with Keccak256
  const hash = Web3.utils.keccak256('0x' + publicKeyBytes);
  
  // Take the last 20 bytes (40 hex characters) as the address
  const address = Web3.utils.toChecksumAddress('0x' + hash.slice(-40));
  
  return address;
}

export interface EthereumTransaction {
  to: string;
  value?: string;
  data?: string;
  nonce?: number;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  chainId?: number;
  rpcUrl?: string; // Optional RPC URL for gas estimation
}

/**
 * Signs an Ethereum transaction using KMS
 */
export async function signTransaction(
  keyId: string,
  transaction: EthereumTransaction,
  region?: string
): Promise<string> {
  const kmsClient = createKMSClient(region);
  
  // Build transaction object with proper types
  const tx: any = {
    to: transaction.to as string,
    chainId: transaction.chainId,
  };
  
  if (transaction.value) {
    tx.value = Web3.utils.toWei(transaction.value, 'ether');
  }
  if (transaction.data) {
    // Ensure data is a hex string with 0x prefix
    tx.data = transaction.data.startsWith('0x') ? transaction.data : '0x' + transaction.data;
  }
  
  // Fetch nonce if not provided
  await fetchNonceIfNeeded(keyId, transaction, tx, region);

  // Handle gas limit
  if (transaction.gasLimit) {
    tx.gasLimit = transaction.gasLimit;
  } else if (transaction.rpcUrl || transaction.chainId) {
    try {
      const rpcUrl = transaction.rpcUrl || getDefaultRpcUrl(transaction.chainId);
      if (rpcUrl) {
        const web3 = new Web3(rpcUrl);
        const estimatedGas = await web3.eth.estimateGas({
          to: transaction.to,
          value: transaction.value ? Web3.utils.toWei(transaction.value, 'ether') : undefined,
          data: transaction.data,
        });
        tx.gasLimit = estimatedGas.toString();
      } else {
        tx.gasLimit = '21000'; // Default gas limit for simple transfer
      }
    } catch (error: any) {
      console.warn(`Warning: Could not fetch gas data from network: ${error.message}`);
      tx.gasLimit = '21000'; // Default gas limit for simple transfer
    }
  } else {
    tx.gasLimit = '21000'; // Default gas limit for simple transfer
  }

  // Determine if we should use EIP-1559 or legacy transaction
  // Only use EIP-1559 if both maxFeePerGas and maxPriorityFeePerGas are explicitly provided
  // Otherwise, use legacy transactions
  const useEIP1559 = !!(transaction.maxFeePerGas && transaction.maxPriorityFeePerGas);
  
  // Handle gas fees (EIP-1559 or legacy)
  if (useEIP1559) {
    // EIP-1559 transaction - both fields must be provided
    tx.maxFeePerGas = transaction.maxFeePerGas!;
    tx.maxPriorityFeePerGas = transaction.maxPriorityFeePerGas!;
  } else {
    // Legacy transaction - use gasPrice
    if (transaction.gasPrice) {
      tx.gasPrice = transaction.gasPrice;
    } else if (transaction.rpcUrl || transaction.chainId) {
      try {
        const rpcUrl = transaction.rpcUrl || getDefaultRpcUrl(transaction.chainId);
        if (rpcUrl) {
          const web3 = new Web3(rpcUrl);
          const gasPrice = await web3.eth.getGasPrice();
          tx.gasPrice = gasPrice;
        } else {
          tx.gasPrice = Web3.utils.toWei('1', 'gwei'); // Default 1 gwei
        }
      } catch (error: any) {
        console.warn(`Warning: Could not fetch gas data from network: ${error.message}`);
        tx.gasPrice = Web3.utils.toWei('1', 'gwei'); // Default 1 gwei
      }
    } else {
      tx.gasPrice = Web3.utils.toWei('1', 'gwei'); // Default 1 gwei
    }
  }
  
  // Get chain configuration
  const chainId = tx.chainId || 1;
  // Create Common instance with proper chain configuration
  // For custom chains, we need to provide chain params
  const common = Common.custom(
    {
      chainId: chainId,
      networkId: chainId, // Use chainId as networkId for custom chains
    },
    {
      baseChain: 'mainnet', // Use mainnet as base
      hardfork: 'merge', // Use latest hardfork
    }
  );
  
  // Prepare common transaction fields (ensure consistent format)
  const toAddress = tx.to ? (tx.to.startsWith('0x') ? tx.to : '0x' + tx.to) : undefined;
  const txDataValue = tx.value ? Web3.utils.toHex(tx.value) : '0x0';
  const txDataNonce = tx.nonce !== undefined ? Web3.utils.toHex(tx.nonce) : '0x0';
  const txDataGasLimit = tx.gasLimit ? Web3.utils.toHex(tx.gasLimit) : '0x5208';
  const txDataData = tx.data ? Buffer.from(tx.data.slice(2), 'hex') : Buffer.alloc(0);
  
  // Build transaction object for @ethereumjs/tx
  let unsignedTx: Transaction | FeeMarketEIP1559Transaction;
  
  if (useEIP1559 && tx.maxFeePerGas && tx.maxPriorityFeePerGas) {
    // EIP-1559 transaction
    const txData = {
      nonce: txDataNonce,
      gasLimit: txDataGasLimit,
      to: toAddress,
      value: txDataValue,
      data: txDataData,
      maxFeePerGas: Web3.utils.toHex(tx.maxFeePerGas),
      maxPriorityFeePerGas: Web3.utils.toHex(tx.maxPriorityFeePerGas),
      chainId: chainId,
    };
    
    unsignedTx = FeeMarketEIP1559Transaction.fromTxData(txData, { common });
  } else {
    // Legacy transaction
    const txData = {
      nonce: txDataNonce,
      gasPrice: tx.gasPrice ? Web3.utils.toHex(tx.gasPrice) : '0x0',
      gasLimit: txDataGasLimit,
      to: toAddress,
      value: txDataValue,
      data: txDataData,
      chainId: chainId,
    };
    
    unsignedTx = Transaction.fromTxData(txData, { common });
  }
  
  // Get the message hash to sign (this is the correct hash for the transaction)
  // getMessageToSign(true) or getMessageToSign() returns the hash (32 bytes) that should be signed
  // getMessageToSign(false) returns the serialized transaction (variable length)
  const messageHash = unsignedTx.getMessageToSign(true);
  
  // Ensure we have exactly 32 bytes for KMS (ECDSA_SHA_256 requires 32-byte digest)
  if (messageHash.length !== 32) {
    throw new Error(`Invalid message hash length: expected 32 bytes, got ${messageHash.length}`);
  }
  
  // Sign with KMS
  const signCommand = new SignCommand({
    KeyId: keyId,
    Message: messageHash,
    MessageType: 'DIGEST',
    SigningAlgorithm: 'ECDSA_SHA_256',
  });
  
  const signResponse = await kmsClient.send(signCommand);
  
  if (!signResponse.Signature) {
    throw new Error('Failed to sign transaction with KMS');
  }
  
  // Convert KMS signature (DER format) to Ethereum format
  // KMS returns DER-encoded signature, we need to parse it to get r and s
  const derSignature = Buffer.from(signResponse.Signature);
  
  // Parse DER signature to get r and s values
  // DER format: 0x30 [length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  let offset = 0;
  
  // Check for SEQUENCE (0x30)
  if (derSignature[offset] !== 0x30) {
    throw new Error('Invalid DER signature: expected SEQUENCE (0x30)');
  }
  offset += 2; // Skip 0x30 and length byte
  
  // Parse r value
  if (derSignature[offset] !== 0x02) {
    throw new Error('Invalid DER signature: expected INTEGER (0x02) for r');
  }
  const rLength = derSignature[offset + 1];
  let rStart = offset + 2;
  
  // Handle leading zero padding (DER allows leading zeros to indicate positive number)
  if (derSignature[rStart] === 0x00 && rLength > 1) {
    rStart++;
  }
  const r = derSignature.slice(rStart, offset + 2 + rLength);
  offset += 2 + rLength;
  
  // Parse s value
  if (offset >= derSignature.length || derSignature[offset] !== 0x02) {
    throw new Error('Invalid DER signature: expected INTEGER (0x02) for s');
  }
  const sLength = derSignature[offset + 1];
  let sStart = offset + 2;
  
  // Handle leading zero padding
  if (derSignature[sStart] === 0x00 && sLength > 1) {
    sStart++;
  }
  const s = derSignature.slice(sStart, offset + 2 + sLength);
  
  // Ensure r and s are 32 bytes (pad with zeros at the start if needed)
  const rPadded = Buffer.alloc(32);
  const sPadded = Buffer.alloc(32);
  
  // Copy r and s to the end of the 32-byte buffers (right-align)
  const rOffset = Math.max(0, 32 - r.length);
  const sOffset = Math.max(0, 32 - s.length);
  r.copy(rPadded, rOffset);
  s.copy(sPadded, sOffset);
  
  // Convert to BigInt to check if s is canonical
  // secp256k1 curve order: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
  const SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  const sBigInt = BigInt('0x' + sPadded.toString('hex'));
  
  // Ensure s is in canonical form (s <= n/2)
  // @ethereumjs/tx requires canonical s, so we must flip it if needed
  const sCanonical = sBigInt > SECP256K1_N / 2n
    ? Buffer.from((SECP256K1_N - sBigInt).toString(16).padStart(64, '0'), 'hex')
    : sPadded;
  
  // When we flip s, we need to adjust recovery IDs:
  // - If s was NOT flipped: try recovery IDs 0, 1
  // - If s WAS flipped: try recovery IDs 2, 3
  const sWasFlipped = sBigInt > SECP256K1_N / 2n;
  
  // Create signature buffers
  const rBuffer = rPadded;
  const sBuffer = sCanonical;
  
  // Try recovery IDs to construct the signed transaction
  // For EIP-1559: yParity can only be 0 or 1
  // For legacy: v = chainId * 2 + 35 + recoveryId, where recoveryId can be 0, 1, 2, or 3
  let lastError: Error | null = null;
  
  if (useEIP1559 && tx.maxFeePerGas && tx.maxPriorityFeePerGas) {
    // EIP-1559: try yParity 0 and 1
    for (let yParity = 0; yParity < 2; yParity++) {
      try {
        const txData = {
          nonce: txDataNonce,
          gasLimit: txDataGasLimit,
          to: toAddress,
          value: txDataValue,
          data: txDataData,
          maxFeePerGas: Web3.utils.toHex(tx.maxFeePerGas),
          maxPriorityFeePerGas: Web3.utils.toHex(tx.maxPriorityFeePerGas),
          chainId: chainId,
          r: rBuffer,
          s: sBuffer,
          yParity: yParity as 0 | 1,
        };
        
        const signedTx = FeeMarketEIP1559Transaction.fromTxData(txData, { common });
        // Return the first valid transaction
        return '0x' + signedTx.serialize().toString('hex');
      } catch (error: any) {
        lastError = error;
        continue;
      }
    }
  } else {
    // Legacy: try recovery IDs based on whether s was flipped
    // If s was flipped, try recovery IDs 2 and 3; otherwise try 0 and 1
    const recoveryIdStart = sWasFlipped ? 2 : 0;
    const recoveryIdEnd = sWasFlipped ? 4 : 2;
    
    for (let recoveryId = recoveryIdStart; recoveryId < recoveryIdEnd; recoveryId++) {
      try {
        const v = chainId * 2 + 35 + recoveryId;
        const txData = {
          nonce: txDataNonce,
          gasPrice: tx.gasPrice ? Web3.utils.toHex(tx.gasPrice) : '0x0',
          gasLimit: txDataGasLimit,
          to: toAddress,
          value: txDataValue,
          data: txDataData,
          chainId: chainId,
          r: rBuffer,
          s: sBuffer,
          v: Web3.utils.toHex(v),
        };
        
        const signedTx = Transaction.fromTxData(txData, { common });
        // Return the first valid transaction
        return '0x' + signedTx.serialize().toString('hex');
      } catch (error: any) {
        lastError = error;
        continue;
      }
    }
  }
  
  // If we get here, none of the recovery IDs worked
  const errorMsg = lastError 
    ? `Could not construct signed transaction: ${lastError.message}` 
    : 'Could not construct signed transaction (tried all recovery IDs)';
  throw new Error(errorMsg);
}

/**
 * Signs a message using KMS
 */
export async function signMessage(
  keyId: string,
  message: string,
  region?: string
): Promise<string> {
  const kmsClient = createKMSClient(region);
  
  // Create Ethereum message hash (EIP-191)
  // Format: \x19Ethereum Signed Message:\n<length in bytes><message>
  const messageBuffer = Buffer.from(message, 'utf8');
  const prefix = Buffer.from('\x19Ethereum Signed Message:\n' + messageBuffer.length.toString(), 'utf8');
  const messageToHash = Buffer.concat([prefix, messageBuffer]);
  const messageHash = Web3.utils.keccak256('0x' + messageToHash.toString('hex'));
  const messageBytes = Buffer.from(messageHash.slice(2), 'hex');
  
  // Sign with KMS
  const signCommand = new SignCommand({
    KeyId: keyId,
    Message: messageBytes,
    MessageType: 'DIGEST',
    SigningAlgorithm: 'ECDSA_SHA_256',
  });
  
  const signResponse = await kmsClient.send(signCommand);
  
  if (!signResponse.Signature) {
    throw new Error('Failed to sign message with KMS');
  }
  
  // Convert signature to hex
  return '0x' + Buffer.from(signResponse.Signature).toString('hex');
}

