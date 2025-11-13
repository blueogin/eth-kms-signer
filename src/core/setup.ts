/**
 * AWS KMS Setup - Create KMS key with ECC_SECG_P256K1 (secp256k1)
 * 
 * Creates a KMS key with native Ethereum support.
 * Reference: https://docs.aws.amazon.com/kms/latest/developerguide/symm-asymm-choose-key-spec.html
 */

import { 
  CreateKeyCommand, 
  CreateAliasCommand, 
  PutKeyPolicyCommand,
  GetParametersForImportCommand,
  ImportKeyMaterialCommand,
} from '@aws-sdk/client-kms';
import { createKMSClient } from './kms-client';
import * as crypto from 'crypto';

/**
 * Converts a raw secp256k1 private key (32 bytes) to PKCS#8 DER format
 * AWS KMS requires ECC key material to be in PKCS#8 format
 * 
 * @param privateKeyBytes - Raw private key as Buffer (32 bytes)
 * @returns PKCS#8 DER encoded private key as Buffer
 */
function privateKeyToPKCS8(privateKeyBytes: Buffer): Buffer {
  if (privateKeyBytes.length !== 32) {
    throw new Error('Private key must be exactly 32 bytes');
  }

  // OIDs
  const EC_PUBLIC_KEY_OID = Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]); // 1.2.840.10045.2.1
  const SECP256K1_OID = Buffer.from([0x2b, 0x81, 0x04, 0x00, 0x0a]); // 1.3.132.0.10

  // Helper function to encode length
  function encodeLength(len: number): Buffer {
    if (len < 0x80) {
      return Buffer.from([len]);
    } else if (len < 0x100) {
      return Buffer.from([0x81, len]);
    } else if (len < 0x10000) {
      return Buffer.from([0x82, len >> 8, len & 0xff]);
    } else {
      throw new Error('Length too large');
    }
  }

  // Helper function to encode ASN.1 tag-length-value
  function encodeTLV(tag: number, value: Buffer): Buffer {
    const length = encodeLength(value.length);
    return Buffer.concat([Buffer.from([tag]), length, value]);
  }

  // ECPrivateKey structure (SEQUENCE)
  // INTEGER 1 (version)
  const version = encodeTLV(0x02, Buffer.from([0x01]));
  
  // OCTET STRING (private key)
  const privateKeyOctet = encodeTLV(0x04, privateKeyBytes);
  
  // ECPrivateKey SEQUENCE
  const ecPrivateKey = Buffer.concat([version, privateKeyOctet]);
  const ecPrivateKeySeq = encodeTLV(0x30, ecPrivateKey);

  // AlgorithmIdentifier SEQUENCE
  // OID for ecPublicKey
  const ecPublicKeyOid = encodeTLV(0x06, EC_PUBLIC_KEY_OID);
  // OID for secp256k1
  const secp256k1Oid = encodeTLV(0x06, SECP256K1_OID);
  // AlgorithmIdentifier SEQUENCE
  const algorithmId = encodeTLV(0x30, Buffer.concat([ecPublicKeyOid, secp256k1Oid]));

  // PKCS#8 PrivateKeyInfo SEQUENCE
  // INTEGER 0 (version)
  const pkcs8Version = encodeTLV(0x02, Buffer.from([0x00]));
  // OCTET STRING containing ECPrivateKey
  const privateKeyOctetString = encodeTLV(0x04, ecPrivateKeySeq);
  
  // PKCS#8 SEQUENCE
  const pkcs8 = Buffer.concat([pkcs8Version, algorithmId, privateKeyOctetString]);
  return encodeTLV(0x30, pkcs8);
}

export interface CreateKeyResult {
  keyId: string;
  keyArn: string;
  aliasName: string;
}

export interface ImportKeyResult {
  keyId: string;
  keyArn: string;
  aliasName: string;
}

/**
 * Creates a new KMS key with ECC_SECG_P256K1 for Ethereum signing
 */
export async function createKMSKey(
  aliasName: string = 'ethereum-signing-key',
  region?: string
): Promise<CreateKeyResult> {
  const kmsClient = createKMSClient(region);
  
  try {
    // Create KMS key with secp256k1 (Ethereum's curve)
    const createKeyCommand = new CreateKeyCommand({
      Description: 'KMS key for Ethereum transaction signing (secp256k1)',
      KeyUsage: 'SIGN_VERIFY',
      KeySpec: 'ECC_SECG_P256K1', // secp256k1 - Ethereum's curve!
      Tags: [
        { TagKey: 'Purpose', TagValue: 'EthereumSigning' },
        { TagKey: 'Environment', TagValue: process.env.NODE_ENV || 'Development' },
      ],
    });

    const createKeyResponse = await kmsClient.send(createKeyCommand);
    
    if (!createKeyResponse.KeyMetadata?.KeyId || !createKeyResponse.KeyMetadata?.Arn) {
      throw new Error('Failed to create KMS key');
    }

    const keyId = createKeyResponse.KeyMetadata.KeyId;
    const keyArn = createKeyResponse.KeyMetadata.Arn;

    // Create alias (optional - skip if no permission)
    let createdAlias: string | undefined;
    try {
      const aliasCommand = new CreateAliasCommand({
        AliasName: `alias/${aliasName}`,
        TargetKeyId: keyId,
      });
      await kmsClient.send(aliasCommand);
      createdAlias = `alias/${aliasName}`;
    } catch (error: any) {
      // Skip alias creation if no permission or already exists
      if (error.name === 'AlreadyExistsException') {
        createdAlias = `alias/${aliasName}`;
      } else if (error.name === 'AccessDeniedException' || error.message?.includes('not authorized')) {
        console.warn(`Warning: Could not create alias (no permission). You can use the key ID directly: ${keyId}`);
        createdAlias = undefined;
      } else {
        // For other errors, still warn but don't fail
        console.warn(`Warning: Could not create alias: ${error.message}. You can use the key ID directly: ${keyId}`);
        createdAlias = undefined;
      }
    }

    // Set key policy
    const accountId = process.env.AWS_ACCOUNT_ID || 'YOUR_ACCOUNT_ID';
    const keyPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'Enable IAM User Permissions',
          Effect: 'Allow',
          Principal: {
            AWS: `arn:aws:iam::${accountId}:root`,
          },
          Action: 'kms:*',
          Resource: '*',
        },
        {
          Sid: 'Allow signing operations',
          Effect: 'Allow',
          Principal: {
            AWS: `arn:aws:iam::${accountId}:root`,
          },
          Action: [
            'kms:Sign',
            'kms:Verify',
            'kms:GetPublicKey',
          ],
          Resource: '*',
        },
      ],
    };

    try {
      const putPolicyCommand = new PutKeyPolicyCommand({
        KeyId: keyId,
        PolicyName: 'default',
        Policy: JSON.stringify(keyPolicy),
      });
      await kmsClient.send(putPolicyCommand);
    } catch (error: any) {
      console.warn(`Warning: Could not update key policy: ${error.message}`);
    }

    return {
      keyId,
      keyArn,
      aliasName: createdAlias || keyId, // Return alias if created, otherwise return keyId
    };
  } catch (error: any) {
    throw new Error(`Failed to create KMS key: ${error.message}`);
  }
}

/**
 * Imports an existing Ethereum private key into AWS KMS
 * 
 * This function:
 * 1. Creates a KMS key with EXTERNAL origin (for imported key material)
 * 2. Gets the wrapping key and import token from KMS
 * 3. Encrypts the private key using RSA-OAEP
 * 4. Imports the encrypted key material into KMS
 * 
 * @param privateKeyHex - Ethereum private key in hex format (with or without 0x prefix)
 * @param aliasName - Optional alias name for the key
 * @param region - AWS region
 * @param expirationDate - Optional expiration date (default: no expiration)
 * @returns ImportKeyResult with keyId, keyArn, and aliasName
 */
export async function importKMSKey(
  privateKeyHex: string,
  aliasName: string = 'ethereum-signing-key-imported',
  region?: string,
  expirationDate?: Date
): Promise<ImportKeyResult> {
  const kmsClient = createKMSClient(region);
  
  try {
    // Normalize private key (remove 0x prefix if present, ensure it's 64 hex chars = 32 bytes)
    let normalizedKey = privateKeyHex.startsWith('0x') 
      ? privateKeyHex.slice(2) 
      : privateKeyHex;
    
    // Validate key length (should be 64 hex characters = 32 bytes)
    if (normalizedKey.length !== 64) {
      throw new Error(`Invalid private key length: expected 64 hex characters (32 bytes), got ${normalizedKey.length}`);
    }
    
    // Validate hex format
    if (!/^[0-9a-fA-F]+$/.test(normalizedKey)) {
      throw new Error('Invalid private key format: must be hexadecimal');
    }
    
    // Convert hex to binary
    const privateKeyBytes = Buffer.from(normalizedKey, 'hex');
    
    // Convert raw private key to PKCS#8 DER format (required by AWS KMS for ECC keys)
    const pkcs8KeyMaterial = privateKeyToPKCS8(privateKeyBytes);
    
    // Step 1: Create KMS key with EXTERNAL origin for imported key material
    const createKeyCommand = new CreateKeyCommand({
      Description: 'KMS key for Ethereum transaction signing with imported key material (secp256k1)',
      KeyUsage: 'SIGN_VERIFY',
      KeySpec: 'ECC_SECG_P256K1', // secp256k1 - Ethereum's curve
      Origin: 'EXTERNAL', // Required for imported key material
      Tags: [
        { TagKey: 'Purpose', TagValue: 'EthereumSigning' },
        { TagKey: 'KeySource', TagValue: 'Imported' },
        { TagKey: 'Environment', TagValue: process.env.NODE_ENV || 'Development' },
      ],
    });

    const createKeyResponse = await kmsClient.send(createKeyCommand);
    
    if (!createKeyResponse.KeyMetadata?.KeyId || !createKeyResponse.KeyMetadata?.Arn) {
      throw new Error('Failed to create KMS key for import');
    }

    const keyId = createKeyResponse.KeyMetadata.KeyId;
    const keyArn = createKeyResponse.KeyMetadata.Arn;

    // Step 2: Get parameters for import (wrapping key and import token)
    const getParamsCommand = new GetParametersForImportCommand({
      KeyId: keyId,
      WrappingAlgorithm: 'RSAES_OAEP_SHA_256',
      WrappingKeySpec: 'RSA_2048',
    });

    const paramsResponse = await kmsClient.send(getParamsCommand);
    
    if (!paramsResponse.PublicKey || !paramsResponse.ImportToken) {
      throw new Error('Failed to get import parameters from KMS');
    }

    const wrappingKeyBytes = Buffer.from(paramsResponse.PublicKey);
    const importToken = Buffer.from(paramsResponse.ImportToken);

    // Step 3: Encrypt the private key using RSA-OAEP
    // The wrapping key is in DER format (SubjectPublicKeyInfo)
    const publicKey = crypto.createPublicKey({
      key: wrappingKeyBytes,
      format: 'der',
      type: 'spki',
    });

    // RSA-OAEP encryption with SHA-256
    // Encrypt the PKCS#8 formatted key material (not raw bytes)
    const encryptedKeyMaterial = crypto.publicEncrypt(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      pkcs8KeyMaterial
    );

    // Step 4: Import the encrypted key material
    const importCommand = new ImportKeyMaterialCommand({
      KeyId: keyId,
      EncryptedKeyMaterial: encryptedKeyMaterial,
      ImportToken: importToken,
      ExpirationModel: expirationDate ? 'KEY_MATERIAL_EXPIRES' : 'KEY_MATERIAL_DOES_NOT_EXPIRE',
      ValidTo: expirationDate,
    });

    await kmsClient.send(importCommand);

    // Create alias (optional - skip if no permission)
    let createdAlias: string | undefined;
    try {
      const aliasCommand = new CreateAliasCommand({
        AliasName: `alias/${aliasName}`,
        TargetKeyId: keyId,
      });
      await kmsClient.send(aliasCommand);
      createdAlias = `alias/${aliasName}`;
    } catch (error: any) {
      // Skip alias creation if no permission or already exists
      if (error.name === 'AlreadyExistsException') {
        createdAlias = `alias/${aliasName}`;
      } else if (error.name === 'AccessDeniedException' || error.message?.includes('not authorized')) {
        console.warn(`Warning: Could not create alias (no permission). You can use the key ID directly: ${keyId}`);
        createdAlias = undefined;
      } else {
        console.warn(`Warning: Could not create alias: ${error.message}. You can use the key ID directly: ${keyId}`);
        createdAlias = undefined;
      }
    }

    // Set key policy (same as createKMSKey)
    const accountId = process.env.AWS_ACCOUNT_ID || 'YOUR_ACCOUNT_ID';
    const keyPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'Enable IAM User Permissions',
          Effect: 'Allow',
          Principal: {
            AWS: `arn:aws:iam::${accountId}:root`,
          },
          Action: 'kms:*',
          Resource: '*',
        },
        {
          Sid: 'Allow signing operations',
          Effect: 'Allow',
          Principal: {
            AWS: `arn:aws:iam::${accountId}:root`,
          },
          Action: [
            'kms:Sign',
            'kms:Verify',
            'kms:GetPublicKey',
          ],
          Resource: '*',
        },
      ],
    };

    try {
      const putPolicyCommand = new PutKeyPolicyCommand({
        KeyId: keyId,
        PolicyName: 'default',
        Policy: JSON.stringify(keyPolicy),
      });
      await kmsClient.send(putPolicyCommand);
    } catch (error: any) {
      console.warn(`Warning: Could not update key policy: ${error.message}`);
    }

    return {
      keyId,
      keyArn,
      aliasName: createdAlias || keyId,
    };
  } catch (error: any) {
    // Provide more detailed error information
    const errorMessage = error.message || 'Unknown error';
    const errorName = error.name || 'UnknownError';
    const errorCode = error.$metadata?.httpStatusCode || error.Code || '';
    
    let detailedMessage = `Failed to import key material: ${errorMessage}`;
    if (errorName !== 'UnknownError') {
      detailedMessage += ` (${errorName})`;
    }
    if (errorCode) {
      detailedMessage += ` [HTTP ${errorCode}]`;
    }
    
    // Add specific guidance for common errors
    if (errorName === 'InvalidCiphertextException' || errorMessage.includes('ciphertext')) {
      detailedMessage += '\nThis may indicate an issue with key material format or encryption.';
    } else if (errorName === 'IncorrectKeyMaterialException' || errorMessage.includes('key material')) {
      detailedMessage += '\nThe key material format may be incorrect. Ensure the private key is valid secp256k1 format.';
    } else if (errorName === 'ExpiredImportTokenException' || errorMessage.includes('token')) {
      detailedMessage += '\nThe import token has expired. The key may need to be recreated.';
    }
    
    throw new Error(detailedMessage);
  }
}

