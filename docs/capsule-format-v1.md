# ZeroDrive capsule format v1

This document defines the byte-level `ZDCP` capsule version 1 format. All integers are unsigned, big-endian, and start at byte offset zero unless stated otherwise.

## Algorithm suite 1

- Per-capsule data key: 32 random bytes, used as AES-256-GCM.
- Metadata and content: AES-256-GCM with separate random 12-byte IVs and 16-byte tags.
- GCM additional authenticated data: the complete serialized header, including all key envelopes.
- Owner derivation: normalized English BIP39 mnemonic, BIP39 seed with empty passphrase, then HKDF-SHA-256 with the header's 16-byte salt and UTF-8 info `zerodrive:capsule:v1:owner-key-wrap`.
- Owner key wrapping: AES-256-KW, producing 40 bytes for the 32-byte data key.
- Recipient key wrapping: RSA-OAEP with SHA-256, MGF1 SHA-256, and an empty label.
- Recipient fingerprint: lowercase hexadecimal SHA-256 of UTF-8 canonical JSON containing exactly `{"e":<e>,"kty":"RSA","n":<n>}` in that property order.

Generated AES keys are non-extractable. Generated recipient keys use a 2048-bit RSA modulus and public exponent 65537.

## Fixed header

| Offset | Size | Field | Required value |
| ---: | ---: | --- | --- |
| 0 | 4 | magic | ASCII `ZDCP` |
| 4 | 1 | format version | `1` |
| 5 | 1 | algorithm suite | `1` |
| 6 | 2 | flags | bit 0 means owner envelope; all other bits zero |
| 8 | 4 | total header length | 68 through 65536 |
| 12 | 4 | metadata ciphertext length | plaintext length plus 16-byte GCM tag |
| 16 | 4 | content ciphertext length | plaintext length plus 16-byte GCM tag |
| 20 | 2 | owner wrapped-key length | `40` when flag bit 0 is set; otherwise `0` |
| 22 | 2 | recipient count | 0 through 64 |
| 24 | 16 | owner HKDF salt | random when owner access exists; otherwise all zero |
| 40 | 12 | metadata IV | random and distinct from content IV |
| 52 | 12 | content IV | random and distinct from metadata IV |
| 64 | 4 | reserved | all zero |

The 68-byte fixed header is followed by the optional owner wrapped key, then exactly `recipient count` recipient entries. Their end must equal the declared header length.

## Recipient entry

| Relative offset | Size | Field | Required value |
| ---: | ---: | --- | --- |
| 0 | 1 | wrapping algorithm | `1` for RSA-OAEP SHA-256 |
| 1 | 4 | recipient key version | 1 through 4294967295 |
| 5 | 32 | public-key fingerprint | raw SHA-256 bytes |
| 37 | 2 | wrapped-key length | 256, 384, or 512 |
| 39 | variable | RSA-wrapped data key | exactly the declared length |

The same fingerprint and key-version pair may appear only once. Writers sort entries by fingerprint and then key version for stable table ordering; readers authenticate the stored order.

## Encrypted sections

The header is followed by the metadata ciphertext and then the content ciphertext, with no padding or trailing bytes. Each ciphertext includes its 16-byte GCM authentication tag.

Metadata plaintext is UTF-8 JSON with required `name`, `mimeType`, and non-negative integer `size` fields, plus optional `createdAt` and JSON `attributes`. Its encoded plaintext is limited to 64 KiB. The metadata `size` must equal the authenticated content plaintext length.

## Parsing requirements

Readers reject unknown versions, suites, algorithms, or flags; invalid or overflowing lengths; malformed metadata; duplicate recipients; zero key versions; IV reuse; nonzero reserved bytes; absent access envelopes; truncated data; and trailing data. Authentication must finish before plaintext is returned or written.

Recipient fingerprints, key versions, recipient count, wrapped-key sizes, section sizes, and the presence of owner recovery are visible. Metadata values and content remain encrypted. Capsule v1 is an in-memory format; streaming and recipient-table mutation are outside this version.
