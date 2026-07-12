# ZeroDrive packages

Small, auditable packages for recovering personal files encrypted by ZeroDrive and stored in a user's Google Drive.

## Packages

### `@zerodrivehq/capsule`

Pure decryption primitives compatible with the current ZeroDrive personal-file format. It derives the same AES-256-GCM key as the web app from a BIP39 recovery phrase and authenticates/decrypts downloaded encrypted bytes.

### `@zerodrivehq/recovery`

A local, offline command-line interface built on the capsule package:

```bash
npx @zerodrivehq/recovery decrypt ./downloaded-file.zd --out ./recovered-file.pdf
```

The CLI prompts for the recovery phrase using hidden terminal input. It does not accept phrases through arguments or environment variables and does not contact Google Drive, ZeroDrive, or any other server.

## Boundaries

This repository does not contain Google Drive clients, database access, shared-file recovery, RSA key recovery, UI code, telemetry, or hosted-service integration. The user downloads the encrypted personal file before running the CLI.

## Development

Node.js 24 and pnpm 11.7 are required.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack:check
```

`dist/` is generated for npm packages and is not committed.

## Publishing order

Both packages start at `0.1.0`. Publish `@zerodrivehq/capsule` before `@zerodrivehq/recovery`, because the CLI depends on the capsule package.
