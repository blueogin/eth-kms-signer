# KMS Ethereum Signing

Native Ethereum transaction signing using AWS KMS with `ECC_SECG_P256K1` (secp256k1) support.

## Features

- ✅ **Native secp256k1 Support**: AWS KMS supports Ethereum's curve natively
- ✅ **Secure Signing**: Private keys never leave KMS (signing in HSM)
- ✅ **Automatic Key Generation**: KMS generates Ethereum key pairs automatically
- ✅ **Import Existing Keys**: Import your existing Ethereum private keys into KMS
- ✅ **TypeScript**: Clean, type-safe implementation

## Quick Start

```bash
# Install dependencies
npm install

# Configure AWS credentials
aws configure

# Option 1: Create a new KMS key (KMS generates the key pair)
npm run setup

# Option 2: Import an existing Ethereum private key into KMS
npm run import <PRIVATE_KEY_HEX> [ALIAS_NAME]

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
import { createKMSKey, importKMSKey, signTransaction, getEthereumAddress, getPublicKey } from './src/index';

// Option 1: Create a new KMS key (KMS generates the key pair)
const { keyId } = await createKMSKey('my-ethereum-key');

// Option 2: Import an existing Ethereum private key into KMS
const { keyId: importedKeyId } = await importKMSKey(
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  'my-imported-key'
);

// Get public key
const publicKey = await getPublicKey(keyId);

// Get Ethereum address
const address = await getEthereumAddress(keyId);

// Sign transaction
const signedTx = await signTransaction(keyId, {
  to: '0x6608BED41902ca642bef6840Ae3Fb94ca76083a8',
  value: '0.00001',
  chainId: 1
});
```

### As CLI

```bash
# Setup KMS key (creates new key with alias - KMS generates the key pair)
npm run setup [alias-name]

# Import existing Ethereum private key into KMS
npm run import <PRIVATE_KEY_HEX> [ALIAS_NAME]

# Sign transaction
npm run sign <KEY_ID> transaction <TO_ADDRESS> [VALUE] [CHAIN_ID]

# Sign message
npm run sign <KEY_ID> message "Hello, Ethereum!"

# Get Ethereum address from KMS key
npm run sign <KEY_ID> address

# Get public key from KMS key
npm run sign <KEY_ID> publickey

# Submit signed transaction to blockchain
npm run submit <SIGNED_TX> [RPC_URL] [CHAIN_ID] [--wait]
```

**Examples:**
```bash
# Create a new key (KMS generates the key pair)
npm run setup my-ethereum-key

# Import an existing private key into KMS
npm run import 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef my-imported-key
# Or without 0x prefix:
npm run import 1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef my-imported-key

# Sign a transaction
npm run sign alias/my-ethereum-key transaction 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb 0.001 1

# Sign a message
npm run sign alias/my-ethereum-key message "Hello, Ethereum!"

# Get address
npm run sign alias/my-ethereum-key address

# Get public key
npm run sign alias/my-ethereum-key publickey

# Sign and submit a transaction (two-step process)
# Step 1: Sign the transaction
npm run sign alias/my-ethereum-key transaction 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb 0.001 1

# Step 2: Submit the signed transaction
npm run submit 0x02f869... https://eth.llamarpc.com 1 --wait

# Or use chain ID to auto-select RPC (Base Sepolia example)
npm run submit 0x02f869... 84532 --wait
```

## Environment Variables

Create a `.env` file in the project root:

```env
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=your_account_id
KMS_KEY_ID=alias/ethereum-signing-key

# Optional: Default RPC URL for transaction submission
RPC_URL=https://eth.llamarpc.com
```

**Getting your AWS Account ID:**
```bash
aws sts get-caller-identity --query Account --output text
```

## How It Works

AWS KMS supports `ECC_SECG_P256K1` (secp256k1) - Ethereum's curve! This means:

1. **KMS generates the Ethereum key pair** automatically when you create the key, OR
2. **You can import your existing private key** into KMS (encrypted with RSA-OAEP)
3. **Private key stays in KMS** (never exposed to your application)
4. **Signing happens in HSM** (hardware security module)
5. **Most secure approach** for Ethereum transaction signing

### Importing Existing Keys

When you import an existing private key:
- The key is encrypted using RSA-OAEP with SHA-256 before being sent to AWS
- AWS KMS stores the key material in a Hardware Security Module (HSM)
- The key can be used for signing just like a KMS-generated key
- You can optionally set an expiration date for the imported key material

**Reference:** 
- [AWS KMS Key Spec Documentation](https://docs.aws.amazon.com/kms/latest/developerguide/symm-asymm-choose-key-spec.html)
- [AWS KMS Import Key Material](https://docs.aws.amazon.com/kms/latest/developerguide/importing-keys.html)

## Prerequisites

- **Node.js** 18+ 
- **AWS Account** with KMS access
- **AWS CLI** configured (`aws configure`)
- **IAM Permissions**:
  - `kms:CreateKey`
  - `kms:CreateAlias`
  - `kms:PutKeyPolicy`
  - `kms:GetParametersForImport` (for importing keys)
  - `kms:ImportKeyMaterial` (for importing keys)
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
