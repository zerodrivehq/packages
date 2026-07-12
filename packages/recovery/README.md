# @zerodrivehq/recovery

Offline recovery CLI for personal files encrypted by the ZeroDrive web app and downloaded from Google Drive.

```bash
npx @zerodrivehq/recovery decrypt ./downloaded-file.zd --out ./recovered-file.pdf
```

The command prompts for the 12-word recovery phrase using hidden terminal input. It never accepts the phrase as a command argument or environment variable, and it does not make network requests.

The input must already be available on the local computer. The output path is required because existing ZeroDrive encrypted files do not contain authenticated filename or MIME-type metadata. Existing output files are never overwritten.

## Security boundary

This package performs local filesystem and terminal orchestration. Cryptographic compatibility is provided by `@zerodrivehq/capsule`.

It does not include Google Drive access, shared-file recovery, RSA keys, database access, telemetry, or hosted ZeroDrive APIs.

JavaScript strings cannot be reliably erased from memory. The CLI clears mutable key, ciphertext, and plaintext buffers where practical, but users should still run recovery only on a computer they trust.
