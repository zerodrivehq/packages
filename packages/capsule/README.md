# @zerodrivehq/capsule

Storage-independent encrypted containers and ZeroDrive integration APIs for Node.js and modern browsers.

```ts
import {
  generateRecoveryPhrase,
  createZeroDrivePersonalFileCapsule,
  openZeroDrivePersonalFile,
} from "@zerodrivehq/capsule";

const recoveryPhrase = generateRecoveryPhrase();
const encryptedBytes = await createZeroDrivePersonalFileCapsule({
  content: new TextEncoder().encode("private contents"),
  metadata: { name: "note.txt", mimeType: "text/plain" },
  recoveryPhrase,
});

const opened = await openZeroDrivePersonalFile({
  encryptedBytes,
  recoveryPhrase,
});
```

## ZeroDrive integration APIs

Applications should use the high-level adapters for ZeroDrive workflows:

- `createZeroDrivePersonalFileCapsule` and `openZeroDrivePersonalFile`
- `createZeroDriveVaultIndexCapsule` and `openZeroDriveVaultIndex`
- `createZeroDriveSharedFileCapsule` and `openZeroDriveSharedFile`
- `createZeroDriveSharedMetadataCapsule` and `openZeroDriveSharedMetadataCapsule`
- `createZeroDriveSharingKeyBackup` and `openZeroDriveSharingKeyBackup`
- `deriveZeroDriveLegacyVaultKey` for read-only legacy recovery

All binary inputs and outputs are `Uint8Array`. Callers decide whether those bytes live in Google Drive, another object store, a database, or memory. The package does not use `File`, `Blob`, filesystem, or network APIs.

New personal files and vault indexes use owner recovery. New shared files use versioned RSA recipients and do not require the sender's recovery phrase. Shared-file adapters accept public and private JWK objects directly, so callers do not import, export, or select legacy RSA algorithms themselves; an existing private `CryptoKey` may also be supplied when available. The open APIs detect capsule v1 by its authenticated header and otherwise invoke the appropriate legacy reader. Results include the detected `ZeroDriveEncryptedFormat`.

Shared metadata can be stored as a small recipient-encrypted capsule when an application needs to render an inbox without downloading the full encrypted file. The metadata opener also reads ZeroDrive's legacy separately encrypted share metadata when its wrapped file key is supplied.

Legacy compatibility covers:

- personal files encoded as 12-byte IV plus AES-GCM ciphertext and tag
- encrypted `db-list.json` metadata in the same legacy AES-GCM layout
- `ZDSE` shared envelopes and pre-`ZDSE` shared ciphertext
- raw base64, PostgreSQL hex, and wrapped-key JSON v1/v2
- legacy Google Drive RSA private-key backups
- explicitly marked legacy RSA-OAEP SHA-1 private keys

Legacy formats are read-only. Every new write uses capsule v1.

## Lower-level API

`createCapsule`, `openCapsule`, `isCapsule`, and `parseCapsuleHeader` remain available for callers that need direct control over capsule metadata and access envelopes.

Each capsule uses a fresh AES-256-GCM data key. Metadata and content are encrypted separately, and the complete header and key-envelope table are authenticated as additional data. Access can be granted to an owner phrase, up to 64 versioned RSA-OAEP SHA-256 recipients, or both.

The package also exports:

- recovery phrase validation and generation
- AES data-key and RSA recipient-key generation
- canonical public-key fingerprints
- header detection and parsing
- owner-only RSA private-key backup capsules
- read-only legacy personal-file, `ZDSE`, wrapped-key, and Google Drive key-backup readers

New code never emits RSA-OAEP SHA-1. It is accepted only when a legacy private JWK explicitly identifies that algorithm. Recovery phrases are normalized and validated in memory; the package never stores or transmits them.

See the repository's `docs/capsule-format-v1.md` for the normative byte format. This package contains no filesystem, storage, OAuth, database, recipient lookup, access-control, expiry, UI, telemetry, or network behavior.
