# ZeroDrive packages

Small, auditable cryptographic and offline-recovery packages for ZeroDrive.

## Packages

### `@zerodrivehq/capsule`

Creates and opens versioned `ZDCP` encrypted containers in Node.js and modern browsers. High-level adapters cover personal files, vault indexes, shared files, and sharing-key backups while preserving read-only compatibility with every current ZeroDrive format.

The package operates only on bytes and keys. It has no storage, OAuth, database, filesystem, UI, logging, analytics, or network APIs.

### `@zerodrivehq/recovery`

An offline CLI for files already downloaded to the user's computer:

```bash
npx @zerodrivehq/recovery decrypt ./downloaded-file.zd --out ./recovered-file.pdf
```

The CLI detects capsule v1 files and existing personal-file ciphertext. It recovers personal files, vault indexes, and sharing private-key backups through hidden recovery-phrase input and never accepts the phrase through arguments, environment variables, or pipes.

## Development

Node.js 24 and pnpm 11.7 are required.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
pnpm build
pnpm pack:check
```

Generated `dist/` directories are not committed. Format details are in [`docs/capsule-format-v1.md`](docs/capsule-format-v1.md).

## Releasing

Both packages are versioned `0.3.0` for this release. After `develop` is merged into `main`, publish `@zerodrivehq/capsule` first and `@zerodrivehq/recovery` second. Feature branches are never published.
