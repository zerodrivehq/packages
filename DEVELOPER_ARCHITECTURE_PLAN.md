# ZeroDrive offline recovery architecture

## Purpose

The `zerodrivehq/packages` repository owns the smallest reusable surface needed to decrypt personal files created by the ZeroDrive web app. The first release exists so a user can recover a file already downloaded from Google Drive without relying on the hosted website.

The repository contains two npm packages:

```txt
@zerodrivehq/capsule
@zerodrivehq/recovery
```

The main application remains in `zerodrivehq/zerodrive`. It owns authentication, Google Drive integration, browser storage, uploads, downloads, UI, shared files, and backend coordination.

## Compatibility target

Current personal files use this byte layout:

```txt
12-byte IV | AES-GCM ciphertext | 16-byte authentication tag
```

There is no magic value, version field, filename, or MIME type inside this format. The CLI therefore requires an explicit output path and cannot infer the original file type from encrypted bytes.

The personal-file key derivation must remain byte-for-byte compatible with the web app:

```txt
BIP39 mnemonic
  -> BIP39 seed with the default empty passphrase
  -> SHA-256 digest
  -> non-extractable AES-256-GCM CryptoKey
```

Changing any derivation input, hash, IV length, tag length, or AES mode would make existing files unrecoverable. Compatibility is protected by committed known-answer vectors rather than round-trip tests alone.

## Package responsibilities

### `@zerodrivehq/capsule`

The capsule package is storage-agnostic and works with bytes. Its v0.1 public API is:

```ts
derivePersonalFileKey(recoveryPhrase: string): Promise<CryptoKey>

decryptPersonalFile(
  encryptedBytes: Uint8Array,
  key: CryptoKey,
): Promise<Uint8Array>

decryptPersonalFileWithRecoveryPhrase(
  encryptedBytes: Uint8Array,
  recoveryPhrase: string,
): Promise<Uint8Array>
```

It normalizes phrase whitespace, validates BIP39 checksums, derives non-extractable keys, enforces the minimum valid payload length, and maps authentication failures to typed errors. It copies IV and ciphertext slices before use so caller-owned input is not mutated, then clears its temporary buffers.

The first release intentionally does not encrypt new files or define a new versioned envelope. It implements recovery compatibility for personal files that already exist.

### `@zerodrivehq/recovery`

The recovery package is a Node.js CLI:

```txt
zerodrive-recovery decrypt <input> --out <output>
```

Its responsibilities are limited to argument validation, local file I/O, an interactive hidden prompt, invoking the capsule package, and writing authenticated plaintext with restrictive permissions.

The CLI refuses non-interactive execution, same input/output paths, non-file inputs, and existing output paths. It creates output with exclusive-create semantics and mode `0600`, syncs it, and removes partial output after a write failure. Mutable ciphertext and plaintext buffers are cleared in `finally` blocks.

The recovery phrase is never accepted from an argument, environment variable, config file, or pipe. JavaScript strings cannot be reliably erased, so documentation must not claim perfect memory zeroization.

## Repository layout

```txt
packages/
  capsule/
    src/
    test/
    package.json
  recovery/
    src/
    test/
    package.json
scripts/
  check-package-contents.mjs
.github/workflows/ci.yml
```

Both packages publish ESM JavaScript, declarations, declaration maps, and source maps from generated `dist/` directories. Source, tests, and fixtures are not included in npm tarballs. Package-content checks also verify that pnpm rewrites the workspace dependency to `^0.1.0`.

## Security boundary

The trusted inputs are the user's recovery phrase and local encrypted file. Recovery runs entirely on the user's computer. Neither package performs network requests or includes telemetry.

The CLI cannot distinguish a wrong but valid mnemonic from modified ciphertext because both correctly fail AES-GCM authentication. Its error message deliberately reports both possibilities.

Dependencies are kept narrow:

- `bip39` provides the derivation behavior already used by the web app.
- `@inquirer/prompts` provides hidden interactive terminal input.
- Node.js supplies WebCrypto, argument parsing, and filesystem primitives.

## Explicitly out of scope

- Google Drive OAuth, listing, or downloading
- hosted ZeroDrive APIs or database records
- recovery manifests or account-wide export formats
- shared files, recipient key wrapping, and RSA private keys
- browser UI and application state
- accepting raw AES keys in the CLI
- overwriting output files
- publishing packages as part of feature development

## Verification and release

CI runs on Node.js 24 and performs a frozen install, strict typechecking, known-answer and failure-mode tests, production builds, and tarball inspection.

Before release, both tarballs should also be installed together in a temporary project and the packed CLI should be exercised against the public compatibility fixture. Publication order is capsule first, then recovery.
