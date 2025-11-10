/**
 * AWS KMS Setup - Create KMS key with ECC_SECG_P256K1 (secp256k1)
 * 
 * Creates a KMS key with native Ethereum support.
 * Reference: https://docs.aws.amazon.com/kms/latest/developerguide/symm-asymm-choose-key-spec.html
 */

import { CreateKeyCommand, CreateAliasCommand, PutKeyPolicyCommand } from '@aws-sdk/client-kms';
import { createKMSClient } from './kms-client';

export interface CreateKeyResult {
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

    // Create alias
    try {
      const aliasCommand = new CreateAliasCommand({
        AliasName: `alias/${aliasName}`,
        TargetKeyId: keyId,
      });
      await kmsClient.send(aliasCommand);
    } catch (error: any) {
      if (error.name !== 'AlreadyExistsException') {
        throw error;
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
      aliasName: `alias/${aliasName}`,
    };
  } catch (error: any) {
    throw new Error(`Failed to create KMS key: ${error.message}`);
  }
}

