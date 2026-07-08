# ZeroDrive packages developer architecture plan

## Purpose

This document explains why ZeroDrive now has an organization, why reusable packages should live in a separate repository, why the first packages should be named `@zerodrivehq/capsule` and `@zerodrivehq/recovery`, and what each package should contain.

It is written for developers who may work on the package repository, review pull requests, or later integrate these packages back into the main ZeroDrive app.

## Current repositories

ZeroDrive should use the GitHub organization as the stable product namespace:

```txt
github.com/zerodrivehq
```

The first repositories should be:

```txt
github.com/zerodrivehq/zerodrive
github.com/zerodrivehq/packages
```

`zerodrive` remains the product application. It contains the frontend, backend, database schema, Docker setup, OAuth integration, MinIO/S3-compatible storage integration, and app-specific user experience.

`packages` becomes the reusable package monorepo. It should contain code that can be used by ZeroDrive and by other projects without bringing the whole ZeroDrive app with it.

## Why the organization is `zerodrivehq`

The organization name should be the public namespace for the project. `zerodrive` was not available, so `zerodrivehq` is the cleanest practical choice.

Reasons:

- It keeps the brand recognizable.
- It works cleanly as a GitHub organization slug.
- It works cleanly as an npm scope: `@zerodrivehq`.
- It is not tied to one product surface, such as web, mobile, backend, or packages.
- It can hold future repositories without making their names repetitive.

Good examples:

```txt
github.com/zerodrivehq/zerodrive
github.com/zerodrivehq/packages
github.com/zerodrivehq/mobile       # possible later
github.com/zerodrivehq/docs         # possible later, only if needed
```

The matching npm package namespace should be:

```txt
@zerodrivehq/capsule
@zerodrivehq/recovery
@zerodrivehq/browser-store
```

If `@zerodrive` ever becomes available on npm, that would be shorter. Until then, `@zerodrivehq` is professional and consistent.

## Why the package repository is named `packages`

Inside the organization, the repo does not need the brand repeated.

Preferred:

```txt
github.com/zerodrivehq/packages
```

Avoid:

```txt
github.com/zerodrivehq/zerodrive-packages
```

`zerodrive-packages` is not wrong, but it is redundant inside the organization. `packages` is cleaner and leaves the repository free to contain several related npm packages.

## Why packages are separated from the main app

The main ZeroDrive repository is an application repository. Its job is to run the product.

It needs:

- React pages and components
- Express routes
- database migrations
- OAuth flows
- cookies and JWT handling
- MinIO/S3-compatible upload/download authorization
- Google Drive integration for personal encrypted storage
- product-specific UI and UX
- deployment configuration

The reusable packages repository has a different job. Its job is to provide stable, well-tested building blocks that can be used by:

- the ZeroDrive web app
- a future ZeroDrive mobile app
- backup and recovery tooling
- another open-source file or photo storage app
- Node.js scripts
- browser-only prototypes

This separation matters because encryption code should not be tightly coupled to a specific UI, database, backend, or storage provider.

The package code should answer:

> How do we safely turn files and metadata into encrypted portable objects?

The app code should answer:

> Where do those encrypted objects get uploaded, listed, shared, deleted, restored, and shown in the UI?

Keeping those concerns separate makes the encryption layer easier to test, audit, document, and reuse.

## High-level package monorepo layout

Recommended initial repository structure:

```txt
packages/
  README.md
  AGENTS.md
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  .github/
    workflows/
      ci.yml
  docs/
    architecture.md
    capsule-format.md
    security-model.md
    threat-model.md
    versioning.md
  packages/
    capsule/
      README.md
      package.json
      tsconfig.json
      src/
        index.ts
        capsule.ts
        keys.ts
        metadata.ts
        recipients.ts
        fingerprints.ts
        encoding.ts
        errors.ts
        types.ts
      test/
        capsule.test.ts
        keys.test.ts
        metadata.test.ts
        recipients.test.ts
        tamper.test.ts
        compatibility.test.ts
    recovery/
      README.md
      package.json
      tsconfig.json
      src/
        index.ts
        manifest.ts
        export.ts
        restore.ts
        types.ts
      test/
        manifest.test.ts
        restore.test.ts
```

Future optional packages:

```txt
packages/
  browser-store/      # IndexedDB/sessionStorage helpers
  node-storage/       # local filesystem helpers, if needed
  storage-s3/         # storage adapter, only if we intentionally support adapters
  cli/                # command-line recovery tool, if recovery grows beyond a library
```

Do not add those future packages until the first two packages are stable.

## Main package: `@zerodrivehq/capsule`

### What “capsule” means

A capsule is a portable encrypted container.

The mental model:

```txt
plaintext file
+ readable metadata
+ recipient information
+ random file key
→ encrypted ZeroDrive capsule
→ store anywhere
```

The storage location can be Google Drive, R2, AWS S3, MinIO, local disk, or a future mobile app. The capsule should not care.

The package name is good because it suggests:

- something packaged
- something sealed
- something portable
- something that protects what is inside

That is exactly the right model for encrypted files and recovery bundles.

### Responsibility

`@zerodrivehq/capsule` should be the pure encryption and encrypted-envelope package.

It should provide:

- AES-256-GCM content encryption
- encrypted metadata
- authenticated versioned envelopes
- random file key generation
- recipient public/private key handling
- file key wrapping for recipients
- key unwrapping for recipients
- key fingerprint helpers
- recovery phrase based key derivation, if needed by the format
- private key backup encryption/decryption
- binary/base64url encoding helpers
- stable TypeScript types
- compatibility tests for old envelope versions

It should not provide:

- React components
- UI state
- Express routes
- database queries
- OAuth logic
- JWT handling
- cookies
- Google Drive API calls
- S3/R2/MinIO upload calls
- access control
- analytics
- logging infrastructure
- IndexedDB storage by default

### Why no storage provider logic

This package should be storage-agnostic.

Storage providers only need encrypted bytes and metadata needed to manage those bytes. If `@zerodrivehq/capsule` starts importing AWS, R2, MinIO, or Google Drive clients, it becomes harder to reuse and harder to trust.

The package should produce encrypted data. The application decides where to put it.

Correct boundary:

```ts
const capsule = await createCapsule(fileBytes, {
  metadata,
  recipients,
});

await storageProvider.putObject(objectKey, capsule.bytes);
```

Incorrect boundary:

```ts
await createCapsuleAndUploadToS3(file, awsCredentials);
```

### Proposed public API

Initial high-level API:

```ts
import {
  createCapsule,
  openCapsule,
  generateDataKey,
  generateRecipientKeyPair,
  fingerprintPublicKey,
} from "@zerodrivehq/capsule";

const recipient = await generateRecipientKeyPair();

const capsule = await createCapsule({
  plaintext: fileBuffer,
  metadata: {
    name: "photo.jpg",
    mimeType: "image/jpeg",
    size: fileBuffer.byteLength,
  },
  recipients: [
    {
      publicKeyJwk: recipient.publicKeyJwk,
      keyVersion: 1,
    },
  ],
});

const opened = await openCapsule({
  capsule: capsule.bytes,
  privateKeys: [
    {
      privateKeyJwk: recipient.privateKeyJwk,
      keyVersion: 1,
    },
  ],
});

console.log(opened.metadata.name);
console.log(opened.plaintext);
```

Lower-level APIs can also exist, but they should be clearly documented:

```ts
generateDataKey()
encryptContent()
decryptContent()
encryptMetadata()
decryptMetadata()
wrapDataKeyForRecipient()
unwrapDataKeyForRecipient()
serializeCapsule()
parseCapsule()
fingerprintPublicKey()
encryptPrivateKeyBackup()
decryptPrivateKeyBackup()
```

The package should prefer a small high-level API first. Low-level APIs should be exported only when they are useful and safe.

### Capsule format

The format must be versioned from day one.

Recommended conceptual structure:

```txt
Capsule v1
  magic bytes
  format version
  algorithm suite
  header length
  encrypted metadata length
  encrypted content length
  recipient table length
  nonce/IV values
  authenticated header
  encrypted metadata
  encrypted content
  recipient key envelopes
```

The exact binary format should be documented in `docs/capsule-format.md` before the package is published.

Minimum design rules:

- include magic bytes so files can be recognized
- include a version number
- include algorithm identifiers
- include lengths so malformed data is rejected safely
- authenticate the header as AES-GCM additional authenticated data
- authenticate metadata and content
- reject unknown unsupported versions
- reject malformed lengths
- reject tampered ciphertext
- do not rely on file extensions for security

Current ZeroDrive reference: `packages/crypto/src/shared-file-envelope.ts` already has a useful starting point with magic bytes, version, algorithm ID, separate metadata/content IVs, lengths, and AES-GCM additional authenticated data.

### Recipient key envelopes

For sharing, each file should have a random content key. That key is wrapped once per recipient.

Conceptually:

```txt
file content key
→ encrypted with recipient public key
→ stored as recipient key envelope
```

A recipient opens the capsule by using their private key to unwrap the file content key.

Recipient envelopes should include:

- envelope version
- key wrapping algorithm
- content encryption algorithm
- recipient key version
- recipient public key fingerprint
- wrapped content key bytes

Current ZeroDrive reference: `packages/crypto/src/shared-key-envelope.ts` already includes versioned wrapped-key envelopes and recipient key fingerprint fields.

### Key fingerprints

Fingerprints make it possible to tell whether a public key has changed.

They should be:

- deterministic for the same public key
- stable across environments
- short enough to show in UI when needed
- generated from canonical public key material

The package should expose:

```ts
fingerprintPublicKey(publicKeyJwk): Promise<string>
```

ZeroDrive can then pin or compare fingerprints without duplicating implementation details.

### Recovery phrase and private key backup

ZeroDrive currently uses a recovery phrase to recreate or unlock encryption access. The package should carefully separate two concepts:

1. A key derived from a recovery phrase.
2. A private sharing key encrypted for backup using a recovery phrase derived wrapping key.

The package can provide:

```ts
generateRecoveryPhrase()
validateRecoveryPhrase()
deriveMasterKeyFromRecoveryPhrase()
deriveWrappingKeyFromRecoveryPhrase()
encryptPrivateKeyBackup()
decryptPrivateKeyBackup()
```

Important: derivation parameters must be documented and versioned. If PBKDF2, salt, iterations, and hash change later, old backups must still open.

Current ZeroDrive reference:

- `apps/web/src/utils/cryptoUtils.ts`
- `apps/web/src/utils/keyStorage.ts`
- `apps/web/src/__tests__/utils/keyRecovery.test.ts`

### Metadata encryption

A capsule should encrypt user-readable metadata such as:

- filename
- MIME type
- file size, when intentionally included
- optional message
- created timestamp, only if needed
- app-specific metadata, only if passed by caller

The package should not assume all metadata fields. It should accept a JSON-compatible object and authenticate it.

Example:

```ts
const capsule = await createCapsule({
  plaintext,
  metadata: {
    name: "passport.pdf",
    mimeType: "application/pdf",
    note: "Documents for visa renewal",
  },
  recipients,
});
```

Anyone without the key should not be able to read that metadata from the capsule.

Current ZeroDrive references:

- `packages/crypto/src/shared-file-envelope.ts`
- `apps/web/src/utils/metadataEncryption.ts`
- `apps/web/src/__tests__/utils/metadataEncryption.test.ts`
- `apps/web/src/__tests__/utils/sharedMetadataEncryption.test.ts`

### Error model

Errors should be typed enough for apps to respond safely.

Recommended error codes:

```txt
CAPSULE_UNSUPPORTED_VERSION
CAPSULE_MALFORMED
CAPSULE_TAMPERED
CAPSULE_NO_MATCHING_RECIPIENT_KEY
CAPSULE_KEY_UNWRAP_FAILED
CAPSULE_METADATA_INVALID
CAPSULE_RECOVERY_PHRASE_INVALID
```

Do not leak sensitive values in error messages.

## Second package: `@zerodrivehq/recovery`

### Responsibility

`@zerodrivehq/recovery` should be the backup and restore package.

It should answer:

> If the hosted ZeroDrive service disappears, what can a user still recover, and how?

It should depend on `@zerodrivehq/capsule` instead of reimplementing encryption.

It should provide:

- backup manifest types
- manifest validation
- export bundle creation
- restore bundle parsing
- recovery status reporting
- helpers for mapping encrypted objects to restored files
- optional CLI later, if needed

It should not provide:

- product UI
- cloud provider uploads
- OAuth
- database access
- server-specific assumptions

### Recovery manifest

The recovery package should define a stable manifest format.

Conceptual example:

```json
{
  "version": 1,
  "createdAt": "2026-07-09T00:00:00.000Z",
  "app": "zerodrive",
  "items": [
    {
      "id": "item_01",
      "type": "personal-file",
      "capsulePath": "objects/item_01.zdcapsule",
      "metadata": {
        "encrypted": true
      }
    }
  ]
}
```

The manifest should avoid storing plaintext sensitive information unless the user intentionally exports it.

### Recovery APIs

Possible API:

```ts
import {
  createRecoveryManifest,
  readRecoveryManifest,
  restoreCapsuleItem,
} from "@zerodrivehq/recovery";

const manifest = createRecoveryManifest({
  items,
});

const restored = await restoreCapsuleItem({
  item: manifest.items[0],
  capsuleBytes,
  recoveryPhrase,
});
```

If a CLI is added later, it can wrap the library:

```bash
zerodrive-recover ./backup-manifest.json --output ./restored-files
```

The CLI may eventually live in:

```txt
@zerodrivehq/recovery-cli
```

or inside `@zerodrivehq/recovery` if it remains small.

## What to reference from the current ZeroDrive app

The packages should not copy application structure, but they should reference the existing work.

Useful current files:

```txt
packages/crypto/src/index.ts
packages/crypto/src/shared-file-envelope.ts
packages/crypto/src/shared-key-envelope.ts
apps/web/src/utils/cryptoUtils.ts
apps/web/src/utils/encryptFile.ts
apps/web/src/utils/keyStorage.ts
apps/web/src/utils/metadataEncryption.ts
apps/web/src/utils/shareCapabilityStorage.ts
apps/web/src/pages/share-files.tsx
apps/web/src/pages/shared-with-me.tsx
apps/api/src/routes/sharedFiles.ts
apps/api/src/routes/publicKeys.ts
apps/api/src/utils/shareCapability.ts
apps/api/src/utils/identity.ts
apps/api/database/migrations/002_anonymous_share_capabilities.sql
apps/api/database/migrations/003_encrypt_shared_file_metadata.sql
apps/api/database/migrations/004_share_storage_lifecycle.sql
apps/api/database/migrations/005_public_key_versions.sql
apps/api/database/migrations/007_purge_legacy_plaintext_metadata.sql
```

Useful current tests:

```txt
apps/web/src/__tests__/utils/encryptFile.test.ts
apps/web/src/__tests__/utils/keyRecovery.test.ts
apps/web/src/__tests__/utils/sharedFileEnvelope.test.ts
apps/web/src/__tests__/utils/sharedKeyEnvelope.test.ts
apps/web/src/__tests__/utils/cryptoUtils.integration.test.ts
apps/web/src/__tests__/utils/metadataEncryption.test.ts
apps/web/src/__tests__/utils/sharedMetadataEncryption.test.ts
apps/api/src/__tests__/integration/sharedFiles.integration.test.ts
apps/api/src/__tests__/integration/publicKeys.test.ts
```

The goal is not to move all of these files into the package repo. The goal is to extract stable reusable behavior and leave application behavior in the app.

## What should stay in `zerodrive`

The following should remain in the main application repo:

- Google OAuth
- JWT and cookie handling
- Express routes
- PostgreSQL schema and migrations
- public key directory endpoints
- anonymous sender capabilities
- MinIO/S3 object lifecycle
- storage quotas
- frontend pages
- upload and download UX
- docs pages
- analytics decisions
- production deployment configuration

Reason: these are application decisions, not reusable encryption primitives.

## What should move or be rebuilt in `packages`

Candidates for extraction:

- versioned encrypted file envelope logic
- wrapped file key envelope logic
- AES-GCM helpers
- metadata encryption helpers
- public key fingerprinting
- recovery phrase helpers
- private key backup encryption
- stable TypeScript types related to capsules
- tamper-detection tests
- compatibility tests

This should be done as a careful rebuild, not a careless copy-paste. The new package API should be cleaner than the current internal utility layout.

## Security design principles

The package repository should follow these rules:

1. Do not invent custom cryptographic primitives.
2. Use Web Crypto compatible primitives where possible.
3. Version every encrypted format.
4. Authenticate headers and metadata.
5. Treat metadata as sensitive by default.
6. Never log plaintext, keys, recovery phrases, or ciphertext internals.
7. Reject malformed data strictly.
8. Add compatibility tests before changing formats.
9. Keep storage and networking out of the core crypto package.
10. Document what is protected and what is not protected.

Initial algorithm suite can match current ZeroDrive:

```txt
Content encryption: AES-256-GCM
Key wrapping: RSA-OAEP-256
Recovery derivation: documented versioned KDF parameters
```

Future versions may consider modern alternatives such as HPKE/X25519, but only through a new versioned envelope.

## Important threat model notes

The package can protect encrypted content from storage providers, database dumps, and people who do not have the right keys.

The package cannot protect users from:

- compromised browser JavaScript
- malicious app code that asks the package to encrypt the wrong thing
- a stolen recovery phrase
- a recipient intentionally sharing decrypted content
- a device already infected with malware

These limits should be written clearly in the package documentation.

## Testing requirements

`@zerodrivehq/capsule` should have stronger tests than normal business logic.

Minimum tests:

- encrypt/decrypt round trip
- wrong key fails
- wrong recipient key fails
- tampered header fails
- tampered metadata fails
- tampered content fails
- malformed length fails
- unsupported version fails
- recipient key fingerprint is stable
- wrapped key envelope version parsing works
- private key backup decrypts with correct phrase
- private key backup fails with wrong phrase
- compatibility fixtures open forever

Compatibility fixtures are especially important.

Example:

```txt
test/fixtures/capsule-v1-basic.bin
test/fixtures/capsule-v1-two-recipients.bin
test/fixtures/private-key-backup-v1.json
```

Once a fixture is added, future versions must continue to read it unless a documented breaking major version intentionally drops support.

## Build and release plan

Recommended tooling:

```txt
pnpm workspaces
TypeScript strict mode
Vitest
tsup or tsdown
ESM output
API Extractor or typedoc later, optional
Changesets for package versioning
GitHub Actions for CI
```

Root scripts:

```json
{
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "changeset": "changeset"
  }
}
```

Package release should start as private or unpublished until the API is stable.

Recommended release sequence:

1. Build package structure.
2. Add docs and threat model.
3. Implement `@zerodrivehq/capsule` v0.1.
4. Add test fixtures.
5. Implement `@zerodrivehq/recovery` v0.1.
6. Try integration in a small example.
7. Only then integrate into `zerodrive`.
8. Publish as `0.x`.
9. Move to `1.0.0` only after format and API confidence.

## Integration back into ZeroDrive

Do not replace all ZeroDrive encryption code immediately.

Recommended integration path:

1. Create packages and tests in `zerodrivehq/packages`.
2. Publish or locally link `@zerodrivehq/capsule`.
3. Replace only shared file envelope parsing first.
4. Run all ZeroDrive sharing tests.
5. Replace key wrapping helpers.
6. Run all frontend and backend security tests.
7. Replace metadata encryption helpers.
8. Keep legacy read compatibility.
9. Remove duplicated app utilities only after production data compatibility is confirmed.

ZeroDrive should continue working during every step.

## Product use cases this enables

### ZeroDrive web

The current product can use `@zerodrivehq/capsule` internally for private encrypted shares and eventually personal encrypted storage.

### Future mobile app

The mobile app can use the same capsule format, so files encrypted on web can be opened on mobile if the user has the right recovery material.

### Open-source photo/file storage product

Another app can provide storage choices such as R2, AWS S3, MinIO, or local disk while relying on `@zerodrivehq/capsule` for client-side encryption.

### Recovery tools

`@zerodrivehq/recovery` can help users restore their data if the hosted ZeroDrive app disappears.

## Acceptance criteria for the first version

The first useful version is ready when:

- `@zerodrivehq/capsule` can create and open encrypted capsules.
- Metadata is encrypted and authenticated.
- Content tampering is detected.
- Recipient key wrapping works.
- Public key fingerprints are stable.
- Private key backup encryption/decryption works.
- The capsule format is documented.
- Tests include wrong-key and tamper cases.
- `@zerodrivehq/recovery` can define and validate a simple recovery manifest.
- Documentation clearly explains what the packages do and do not protect.

## Summary

`zerodrivehq/zerodrive` is the application.

`zerodrivehq/packages` is the reusable toolkit.

`@zerodrivehq/capsule` is the encrypted portable container layer.

`@zerodrivehq/recovery` is the backup and restore layer built on top of capsules.

This separation keeps ZeroDrive’s encryption model reusable without dragging the entire app, backend, database, or storage provider assumptions into every future project.
