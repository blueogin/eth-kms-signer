/**
 * Ethereum Transaction Signing with AWS KMS
 * 
 * Uses KMS ECC_SECG_P256K1 key to sign Ethereum transactions natively.
 * Private key never leaves KMS - signing happens in HSM!
 */

import { SignCommand, GetPublicKeyCommand } from '@aws-sdk/client-kms';
import { ethers } from 'ethers';
import { createKMSClient } from './kms-client';

// Common RPC endpoints for different chains (same as submit.ts)
const CHAIN_RPC_URLS: Record<number, string> = {
  1: 'https://eth.llamarpc.com',
  137: 'https://polygon-rpc.com',
  56: 'https://bsc-dataseed.binance.org/',
  43114: 'https://api.avax.network/ext/bc/C/rpc',
  250: 'https://rpc.ftm.tools/',
  42161: 'https://arb1.arbitrum.io/rpc',
  10: 'https://mainnet.optimism.io',
  8453: 'https://mainnet.base.org',
  5: 'https://goerli.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
  11155111: 'https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
  80001: 'https://rpc-mumbai.maticvigil.com',
  97: 'https://data-seed-prebsc-1-s1.binance.org:8545',
  43113: 'https://api.avax-test.network/ext/bc/C/rpc',
  421611: 'https://rinkeby.arbitrum.io/rpc',
  84532: 'https://sepolia.base.org',
};

function getDefaultRpcUrl(chainId?: number): string | undefined {
  return chainId ? CHAIN_RPC_URLS[chainId] : undefined;
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
  const hash = ethers.keccak256('0x' + publicKeyBytes);
  
  // Take the last 20 bytes (40 hex characters) as the address
  const address = ethers.getAddress('0x' + hash.slice(-40));
  
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
  
  const fromAddress = await getEthereumAddress(keyId, region);
  
  // Build transaction object with proper types
  const tx: any = {
    to: transaction.to as string,
    chainId: transaction.chainId,
  };
  
  if (transaction.value) {
    tx.value = ethers.parseEther(transaction.value);
  }
  if (transaction.data) {
    tx.data = transaction.data;
  }
  if (transaction.nonce !== undefined) {
    tx.nonce = transaction.nonce;
  }
  
  // If gas values are not provided, estimate them from network
  if (!transaction.gasLimit || !transaction.gasPrice) {
    if (transaction.rpcUrl || transaction.chainId) {
      try {
        const rpcUrl = transaction.rpcUrl || getDefaultRpcUrl(transaction.chainId);
        if (rpcUrl) {
          const provider = new ethers.JsonRpcProvider(rpcUrl);
          
          // Estimate gas limit
          if (!transaction.gasLimit) {
            const gasEstimate = await provider.estimateGas({
              to: transaction.to,
              value: transaction.value ? ethers.parseEther(transaction.value) : undefined,
              data: transaction.data,
            });
            tx.gasLimit = gasEstimate;
          } else {
            tx.gasLimit = BigInt(transaction.gasLimit);
          }
          
          // Get fee data (supports both EIP-1559 and legacy)
          const feeData = await provider.getFeeData();
          
          if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
            // EIP-1559 transaction
            tx.maxFeePerGas = feeData.maxFeePerGas;
            tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
          } else if (feeData.gasPrice) {
            // Legacy transaction
            tx.gasPrice = feeData.gasPrice;
          } else {
            // Fallback: use provided gasPrice or set a default
            if (transaction.gasPrice) {
              tx.gasPrice = BigInt(transaction.gasPrice);
            } else {
              // Default gas price (1 gwei)
              tx.gasPrice = ethers.parseUnits('1', 'gwei');
            }
          }
        }
      } catch (error: any) {
        console.warn(`Warning: Could not fetch gas data from network: ${error.message}`);
        // Fallback to defaults
        if (!transaction.gasLimit) {
          tx.gasLimit = 21000n; // Default gas limit for simple transfer
        }
        if (!transaction.gasPrice) {
          tx.gasPrice = ethers.parseUnits('1', 'gwei'); // Default 1 gwei
        }
      }
    } else {
      // No RPC URL or chain ID, use defaults
      if (!transaction.gasLimit) {
        tx.gasLimit = 21000n; // Default gas limit for simple transfer
      }
      if (!transaction.gasPrice) {
        tx.gasPrice = ethers.parseUnits('1', 'gwei'); // Default 1 gwei
      }
    }
  } else {
    // Use provided values
    if (transaction.gasLimit) {
      tx.gasLimit = BigInt(transaction.gasLimit);
    }
    if (transaction.gasPrice) {
      tx.gasPrice = BigInt(transaction.gasPrice);
    }
  }
  
  // Handle EIP-1559 fees if provided
  if (transaction.maxFeePerGas) {
    tx.maxFeePerGas = BigInt(transaction.maxFeePerGas);
  }
  if (transaction.maxPriorityFeePerGas) {
    tx.maxPriorityFeePerGas = BigInt(transaction.maxPriorityFeePerGas);
  }
  
  // Serialize and hash transaction
  const serializedTx = ethers.Transaction.from(tx).unsignedSerialized;
  const txHash = ethers.keccak256(serializedTx);
  const messageHash = ethers.getBytes(txHash);
  
  // Sign with KMS
  const signCommand = new SignCommand({
    KeyId: keyId,
    Message: Buffer.from(messageHash),
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
  
  // If s > n/2, flip it (canonical form)
  let sCanonical = sPadded;
  if (sBigInt > SECP256K1_N / 2n) {
    const sFlipped = SECP256K1_N - sBigInt;
    sCanonical = Buffer.from(sFlipped.toString(16).padStart(64, '0'), 'hex');
  }
  
  // Create signature object with r and s
  const signature = {
    r: '0x' + rPadded.toString('hex'),
    s: '0x' + sCanonical.toString('hex'),
    v: 0, // Will be calculated by ethers
  };
  
  // Create signed transaction
  const signedTx = ethers.Transaction.from({
    ...tx,
    signature: signature,
  });
  
  return signedTx.serialized;
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
  const messageHash = ethers.hashMessage(message);
  const messageBytes = ethers.getBytes(messageHash);
  
  // Sign with KMS
  const signCommand = new SignCommand({
    KeyId: keyId,
    Message: Buffer.from(messageBytes),
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

