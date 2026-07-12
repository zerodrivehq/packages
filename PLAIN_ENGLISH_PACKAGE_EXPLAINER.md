# ZeroDrive offline recovery, in plain English

## The goal

A personal file uploaded through ZeroDrive is encrypted on the user's device before it reaches Google Drive. If the hosted ZeroDrive website is unavailable, the encrypted file should not become useless.

The recovery tool gives the user another path:

```txt
download encrypted file from Google Drive
  -> run a command on a trusted computer
  -> enter the 12-word recovery phrase privately
  -> receive the original file contents
```

Nothing is uploaded during recovery. The phrase and file stay on the user's computer.

## The two packages

### Capsule

`@zerodrivehq/capsule` understands the lock already used on personal ZeroDrive files.

The web app turns the recovery phrase into a 256-bit AES key. Each encrypted file starts with a fresh 12-byte IV, followed by the encrypted content and an authentication tag. The tag lets the decryptor detect a wrong phrase or a modified file instead of returning damaged plaintext.

The capsule package repeats that exact process in reverse. It accepts encrypted bytes and either a recovery phrase or an already-derived key, then returns plaintext only after authentication succeeds.

It does not know where the file came from or where the plaintext will go. That makes the cryptographic part smaller and easier to test.

### Recovery

`@zerodrivehq/recovery` is the command people run:

```bash
npx @zerodrivehq/recovery decrypt ./downloaded-file.zd --out ./file.pdf
```

It checks the paths, asks for the phrase with hidden terminal input, reads the local encrypted file, asks the capsule package to decrypt it, and writes the result.

The output path is required. Existing personal files do not carry authenticated filename or MIME-type information inside their encrypted bytes, so the tool cannot reliably guess whether the result is a PDF, image, or another file type.

## Why the phrase is prompted

Commands typed into a shell may be stored in shell history. Other programs may also be able to inspect command arguments while a process is running. For that reason, this is intentionally unsupported:

```bash
# Unsupported and unsafe
zerodrive-recovery decrypt file.zd --phrase "twelve secret words ..."
```

The CLI requires a real interactive terminal and hides input while the user types. It does not accept the phrase from an environment variable, pipe, or configuration file.

## What users must provide

Recovery v0.1 needs:

- the encrypted personal file downloaded from Google Drive
- the same 12-word recovery phrase used by ZeroDrive
- a local output filename
- Node.js 24 or newer

The tool does not sign in to Google Drive. Downloading the encrypted file remains a separate user action.

## Safety behavior

The tool will not overwrite an existing output file. It will not create plaintext if authentication fails. Output is created with owner-only permissions on systems that support Unix permission modes, and partial output is removed when a normal write error occurs.

A wrong but valid recovery phrase and a corrupted encrypted file look identical to AES-GCM: both fail authentication. The CLI therefore explains both possibilities without pretending to know which one occurred.

The implementation clears mutable buffers when practical. JavaScript cannot guarantee that immutable strings such as the typed recovery phrase are immediately erased from memory, so recovery should only be run on a trusted computer.

## What this release does not do

This release does not recover shared files, contact the ZeroDrive backend, query a database, browse Google Drive, process recovery manifests, accept raw AES key files, encrypt new files, or introduce a new encrypted-file format.

Its promise is deliberately narrow and testable: decrypt an existing personal ZeroDrive file locally with the correct recovery phrase.
