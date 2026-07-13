# @zerodrivehq/recovery

Offline recovery CLI for ZeroDrive files already downloaded to the local computer.

```bash
npx @zerodrivehq/recovery decrypt ./downloaded-file.zd --out ./recovered-file.pdf
```

The command detects `ZDCP` capsule v1 files and existing personal-file ciphertext. It asks for the 12-word phrase through hidden interactive terminal input, fully authenticates the file, and only then creates the output with exclusive `0600` permissions. Existing files are never overwritten and partial output is removed after write failures.

The phrase cannot be supplied through command arguments, environment variables, configuration, or a pipe. The CLI performs no network requests and does not sign in to Google Drive or contact ZeroDrive.

Legacy personal files do not contain authenticated filename or MIME-type metadata. Capsule v1 does, but `--out` remains explicit and determines the recovered local filename.

JavaScript strings cannot be reliably erased from memory. Mutable ciphertext and plaintext buffers are cleared where practical, but recovery should only be run on a trusted computer.
