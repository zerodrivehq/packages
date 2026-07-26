# @zerodrivehq/recovery

Offline recovery CLI for ZeroDrive files already downloaded to the local computer.

```bash
npx @zerodrivehq/recovery decrypt ./downloaded-file.zd --out ./recovered-file.pdf
```

The command detects `ZDCP` capsule v1 files and existing personal-file ciphertext. Capsule content may be a personal file, a vault index, or a sharing private-key backup. Legacy personal files, `db-list.json`, and Google Drive private-key backups use the same authenticated legacy byte layout and remain recoverable.

The CLI uses the high-level `@zerodrivehq/capsule` compatibility APIs. It asks for the 12-word phrase through hidden interactive terminal input, fully authenticates the input, and only then creates the output with exclusive `0600` permissions. Existing files are never overwritten and partial output is removed after write failures.

The phrase cannot be supplied through command arguments, environment variables, configuration, or a pipe. The CLI performs no network requests and does not sign in to Google Drive or contact ZeroDrive.

Legacy personal files do not contain authenticated filename or MIME-type metadata. Capsule v1 does, but `--out` remains explicit and determines the recovered local filename. A recovered vault index is JSON. A recovered sharing-key backup is written as a direct private JWK JSON object.

JavaScript strings cannot be reliably erased from memory. Mutable ciphertext and plaintext buffers are cleared where practical, but recovery should only be run on a trusted computer.
