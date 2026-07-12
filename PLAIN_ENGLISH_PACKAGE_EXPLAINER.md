# ZeroDrive capsule and recovery, in plain English

## Capsule

A capsule is an encrypted container for one file. Every new capsule gets its own random AES key. That key encrypts both the file contents and private metadata such as the filename and MIME type.

The AES key can then be unlocked in two ways:

- The owner can use the 12-word recovery phrase.
- A recipient can use the matching RSA private key and key version.

One capsule may support both methods and up to 64 recipients. The file is encrypted only once; each allowed person receives a small encrypted copy of its AES key. Any change to the header, recipient list, metadata, or content causes authentication to fail.

The package can also generate phrases, AES keys, and RSA key pairs; fingerprint public keys; create owner-only private-key backups; and read old ZeroDrive personal and shared formats. It never uploads, downloads, lists recipients, grants application permissions, or contacts a server.

## Recovery CLI

The recovery command handles a file the user has already downloaded:

```bash
npx @zerodrivehq/recovery decrypt ./downloaded-file.zd --out ./file.pdf
```

It privately prompts for the phrase, detects whether the input is a new capsule or an existing personal file, authenticates it, and writes the recovered bytes. It refuses to overwrite an output file and does not create plaintext when authentication fails.

Old personal files have no encrypted filename or MIME type, so the user chooses the output name. New capsules contain authenticated metadata, but the CLI still uses the explicit `--out` path for predictable and safe filesystem behavior.

## Boundaries

Creating an RSA key pair does not itself share a file. The application still decides who a recipient is, obtains the correct public key, stores files, and delivers invitations. Capsule only performs the cryptographic transformation after those decisions have been made.

The phrase, private keys, encrypted bytes, and plaintext stay in local memory. Mutable buffers are cleared where practical, but JavaScript cannot promise immediate erasure of strings, so recovery should run only on a trusted computer.
