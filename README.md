# KMS Ethereum Signing

Native Ethereum transaction signing using AWS KMS with `ECC_SECG_P256K1` (secp256k1) support.

## Features

- ✅ **Native secp256k1 Support**: AWS KMS supports Ethereum's curve natively
- ✅ **Secure Signing**: Private keys never leave KMS (signing in HSM)
- ✅ **Automatic Key Generation**: KMS generates Ethereum key pairs automatically
- ✅ **TypeScript**: Clean, type-safe implementation

## Quick Start

```bash
# Install dependencies
npm install

# Configure AWS credentials
aws configure

# Create KMS key
npm run setup

# Sign a transaction
npm run sign alias/ethereum-signing-key transaction 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb 0.001 1
```

## Project Structure

```
KMS_Integration/
├── src/
│   ├── core/              # Core library code
│   │   ├── kms-client.ts  # KMS client configuration
│   │   ├── setup.ts       # Create KMS keys
│   │   └── signing.ts     # Sign transactions
│   ├── cli/               # CLI commands
│   │   ├── setup.ts       # Setup command
│   │   └── sign.ts        # Sign command
│   └── index.ts           # Main export
├── package.json
├── tsconfig.json
└── README.md
```

## Usage

### As a Library

```typescript
import { createKMSKey, signTransaction, getEthereumAddress } from './src/index';

// Create KMS key
const { keyId } = await createKMSKey('my-ethereum-key');

// Get Ethereum address
const address = await getEthereumAddress(keyId);

// Sign transaction
const signedTx = await signTransaction(keyId, {
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  value: '0.001',
  chainId: 1
});
```

### As CLI

```bash
# Setup KMS key (creates key with alias)
npm run setup [alias-name]

# Sign transaction
npm run sign <KEY_ID> transaction <TO_ADDRESS> [VALUE] [CHAIN_ID]

# Sign message
npm run sign <KEY_ID> message "Hello, Ethereum!"

# Get Ethereum address from KMS key
npm run sign <KEY_ID> address
```

**Examples:**
```bash
# Create a key
npm run setup my-ethereum-key

# Sign a transaction
npm run sign alias/my-ethereum-key transaction 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb 0.001 1

# Sign a message
npm run sign alias/my-ethereum-key message "Hello, Ethereum!"

# Get address
npm run sign alias/my-ethereum-key address
```

## Environment Variables

Create a `.env` file in the project root:

```env
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=your_account_id
KMS_KEY_ID=alias/ethereum-signing-key
```

**Getting your AWS Account ID:**
```bash
aws sts get-caller-identity --query Account --output text
```

## How It Works

AWS KMS supports `ECC_SECG_P256K1` (secp256k1) - Ethereum's curve! This means:

1. **KMS generates the Ethereum key pair** automatically when you create the key
2. **Private key stays in KMS** (never exposed to your application)
3. **Signing happens in HSM** (hardware security module)
4. **Most secure approach** for Ethereum transaction signing

**Reference:** [AWS KMS Key Spec Documentation](https://docs.aws.amazon.com/kms/latest/developerguide/symm-asymm-choose-key-spec.html)

## Prerequisites

- **Node.js** 18+ 
- **AWS Account** with KMS access
- **AWS CLI** configured (`aws configure`)
- **IAM Permissions**:
  - `kms:CreateKey`
  - `kms:CreateAlias`
  - `kms:PutKeyPolicy`
  - `kms:Sign`
  - `kms:GetPublicKey`
  - `kms:DescribeKey`

```bash
# Build TypeScript
npm run build

# Clean build artifacts
npm run clean

# Run in development mode
npm run dev
```
