# ZeroDrive capsule and recovery architecture

## Ownership

`@zerodrivehq/capsule` owns cryptographic bytes, keys, metadata validation, versioned formats, and read-only legacy compatibility. It is runtime-neutral and works with `Uint8Array`, Web Crypto, and JWK values.

`@zerodrivehq/recovery` owns the Node.js terminal and local-filesystem workflow. It detects a `ZDCP` magic prefix and calls `openCapsule`; inputs without that prefix use the preserved personal-file decryptor.

The main ZeroDrive application owns OAuth, Google Drive, databases, recipient lookup, invitations, access control, UI, and application state. Those concerns must not enter either package.

## Capsule v1

A fresh random AES-256-GCM key encrypts each capsule's metadata and content with distinct IVs. The complete header and access-envelope table are authenticated by both encrypted sections. The owner receives an AES-KW envelope derived from a BIP39 phrase through HKDF-SHA-256; recipients receive RSA-OAEP SHA-256 envelopes identified by a canonical public-key fingerprint and application-managed key version.

The format supports 64 recipients and 64 KiB of authenticated metadata. It is deliberately in-memory. Changing recipients means creating a new capsule; streaming and envelope mutation are follow-up designs. The normative layout is in `docs/capsule-format-v1.md`.

## Compatibility

The `0.1.0` personal-file APIs remain unchanged. Their compatibility fixture protects the web-app derivation and `12-byte IV | ciphertext | 16-byte tag` layout.

Read-only helpers support existing `ZDSE` shared envelopes, pre-envelope shared ciphertext plus metadata, raw base64 and PostgreSQL-hex wrapped keys, wrapped-key JSON versions 1 and 2, and existing recovery-phrase-encrypted Google Drive RSA backups. RSA-OAEP SHA-1 is used only when an old private JWK explicitly declares it; no new SHA-1 data is generated.

## Security behavior

Parsing is exact and authenticated. Unknown fields, malformed lengths, duplicate access identities, IV reuse, and trailing bytes fail closed. Wrong phrases, wrong recipient keys, and tampering never return plaintext. Temporary mutable seed, key, ciphertext, metadata, and plaintext buffers are cleared where JavaScript permits.

The recovery CLI requires an interactive hidden prompt, exclusive output creation, restrictive permissions, and full authentication before output creation. It never accepts phrase arguments or environment variables and performs no network requests.

## Delivery

Both packages build ESM, declarations, and source maps into untracked `dist/` directories. CI performs a frozen install, typechecking, Node and Chromium compatibility tests, builds, and tarball verification. Release `0.2.0` only after `develop` reaches `main`, with capsule published before recovery.
