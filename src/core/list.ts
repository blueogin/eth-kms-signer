/**
 * AWS KMS Key Listing
 * 
 * Functions to list and describe KMS keys
 */

import { 
  ListKeysCommand,
  DescribeKeyCommand,
  ListAliasesCommand,
} from '@aws-sdk/client-kms';
import { createKMSClient } from './kms-client';

export interface KeyInfo {
  keyId: string;
  keyArn: string;
  alias?: string;
  description?: string;
  keySpec?: string;
  keyUsage?: string;
  keyState?: string;
  creationDate?: Date;
  enabled?: boolean;
}

/**
 * Lists all KMS keys in the specified region
 * 
 * @param region - AWS region (defaults to AWS_REGION env var or us-east-1)
 * @param includeDetails - Whether to include detailed information for each key (default: true)
 * @returns Array of key information
 */
export async function listKMSKeys(
  region?: string,
  includeDetails: boolean = true
): Promise<KeyInfo[]> {
  const kmsClient = createKMSClient(region);
  const keys: KeyInfo[] = [];
  
  try {
    // List all keys
    const listKeysCommand = new ListKeysCommand({});
    const listKeysResponse = await kmsClient.send(listKeysCommand);
    
    if (!listKeysResponse.Keys || listKeysResponse.Keys.length === 0) {
      return [];
    }

    // Get all aliases to map them to keys
    const listAliasesCommand = new ListAliasesCommand({});
    const aliasesResponse = await kmsClient.send(listAliasesCommand);
    const aliasMap = new Map<string, string>();
    
    if (aliasesResponse.Aliases) {
      for (const alias of aliasesResponse.Aliases) {
        if (alias.TargetKeyId && alias.AliasName) {
          aliasMap.set(alias.TargetKeyId, alias.AliasName);
        }
      }
    }

    // Get details for each key if requested
    for (const key of listKeysResponse.Keys) {
      if (!key.KeyId) continue;

      const keyInfo: KeyInfo = {
        keyId: key.KeyId,
        keyArn: key.KeyArn || '',
        alias: aliasMap.get(key.KeyId),
      };

      if (includeDetails) {
        try {
          const describeCommand = new DescribeKeyCommand({
            KeyId: key.KeyId,
          });
          const describeResponse = await kmsClient.send(describeCommand);
          
          if (describeResponse.KeyMetadata) {
            const metadata = describeResponse.KeyMetadata;
            keyInfo.description = metadata.Description;
            keyInfo.keySpec = metadata.KeySpec;
            keyInfo.keyUsage = metadata.KeyUsage;
            keyInfo.keyState = metadata.KeyState;
            keyInfo.creationDate = metadata.CreationDate;
            keyInfo.enabled = metadata.Enabled;
          }
        } catch (error: any) {
          // If we can't describe the key (e.g., no permissions), just skip details
          console.warn(`Warning: Could not describe key ${key.KeyId}: ${error.message}`);
        }
      }

      keys.push(keyInfo);
    }

    return keys;
  } catch (error: any) {
    throw new Error(`Failed to list KMS keys: ${error.message}`);
  }
}

