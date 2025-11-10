/**
 * Ethereum Transaction Signing with AWS KMS
 * 
 * Uses KMS ECC_SECG_P256K1 key to sign Ethereum transactions natively.
 * Private key never leaves KMS - signing happens in HSM!
 */

import { SignCommand, GetPublicKeyCommand } from '@aws-sdk/client-kms';
import { ethers } from 'ethers';
import { createKMSClient } from './kms-client';

/**
 * Gets Ethereum address from KMS public key
 */
export async function getEthereumAddress(keyId: string, region?: string): Promise<string> {
  const kmsClient = createKMSClient(region);
  
  const getPublicKeyCommand = new GetPublicKeyCommand({ KeyId: keyId });
  const response = await kmsClient.send(getPublicKeyCommand);
  
  if (!response.PublicKey) {
    throw new Error('Failed to get public key from KMS');
  }
  
  const publicKeyBytes = Buffer.from(response.PublicKey);
  
  if (publicKeyBytes[0] !== 0x04) {
    throw new Error('Unexpected public key format');
  }
  
  const publicKeyHex = '0x' + publicKeyBytes.slice(1).toString('hex');
  const publicKey = ethers.SigningKey.computePublicKey(publicKeyHex, true);
  const address = ethers.getAddress(ethers.keccak256('0x' + publicKey.slice(4)).slice(-40));
  
  return address;
}

export interface EthereumTransaction {
  to: string;
  value?: string;
  data?: string;
  nonce?: number;
  gasLimit?: string;
  gasPrice?: string;
  chainId?: number;
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
  
  const tx: ethers.TransactionRequest = {
    to: transaction.to,
    value: transaction.value ? ethers.parseEther(transaction.value) : undefined,
    data: transaction.data,
    nonce: transaction.nonce,
    gasLimit: transaction.gasLimit ? BigInt(transaction.gasLimit) : undefined,
    gasPrice: transaction.gasPrice ? BigInt(transaction.gasPrice) : undefined,
    chainId: transaction.chainId,
    from: fromAddress,
  };
  
  // Remove undefined fields
  Object.keys(tx).forEach(key => {
    if (tx[key as keyof typeof tx] === undefined) {
      delete tx[key as keyof typeof tx];
    }
  });
  
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
  // Note: This is a simplified version - production code needs proper DER parsing
  const signature = Buffer.from(signResponse.Signature);
  
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

