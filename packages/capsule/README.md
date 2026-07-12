# @zerodrivehq/capsule

Decryption primitives for personal files produced by the current ZeroDrive web app.

```ts
import {
  decryptPersonalFileWithRecoveryPhrase,
} from "@zerodrivehq/capsule";

const plaintext = await decryptPersonalFileWithRecoveryPhrase(
  encryptedBytes,
  recoveryPhrase,
);
```

The v0.1 compatibility format is the existing personal-file layout:

```txt
12-byte AES-GCM IV | ciphertext | 16-byte authentication tag
```

The AES-256-GCM key is derived exactly as it is in the ZeroDrive web app: the BIP39 mnemonic is converted to its seed and the seed is hashed with SHA-256.

This release decrypts personal files only. It does not implement encryption, shared files, RSA keys, manifests, storage providers, filesystem access, telemetry, or network access.
