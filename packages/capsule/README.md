# @zerodrivehq/capsule

Storage-independent encrypted containers and ZeroDrive compatibility primitives for Node.js and modern browsers.

```ts
import {
  createCapsule,
  generateRecoveryPhrase,
  openCapsule,
} from "@zerodrivehq/capsule";

const recoveryPhrase = generateRecoveryPhrase();
const plaintext = new TextEncoder().encode("private contents");
const created = await createCapsule({
  plaintext,
  metadata: {
    name: "note.txt",
    mimeType: "text/plain",
    size: plaintext.byteLength,
  },
  recoveryPhrase,
});

const opened = await openCapsule({
  capsule: created.bytes,
  recoveryPhrase,
});
```

Each capsule uses a fresh AES-256-GCM data key. Metadata and content are encrypted separately, and the complete header and key-envelope table are authenticated as additional data. Access can be granted to an owner phrase, up to 64 versioned RSA-OAEP SHA-256 recipients, or both.

The package also exports:

- recovery phrase validation and generation
- AES data-key and RSA recipient-key generation
- canonical public-key fingerprints
- header detection and parsing
- owner-only RSA private-key backup capsules
- read-only legacy personal-file, `ZDSE`, wrapped-key, and Google Drive key-backup readers

New code never emits RSA-OAEP SHA-1. It is accepted only when a legacy private JWK explicitly identifies that algorithm.

See the repository's `docs/capsule-format-v1.md` for the normative byte format. This package contains no filesystem, storage, OAuth, database, recipient lookup, access-control, expiry, UI, telemetry, or network behavior.
