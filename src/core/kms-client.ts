/**
 * AWS KMS Client Configuration
 */

import { KMSClient } from '@aws-sdk/client-kms';
import * as dotenv from 'dotenv';

dotenv.config();

export function createKMSClient(region?: string): KMSClient {
  return new KMSClient({
    region: region || process.env.AWS_REGION || 'us-east-1',
  });
}

