# ZeroDrive packages

Reusable privacy and recovery packages for ZeroDrive.

This repository is intentionally separate from the main ZeroDrive app. The app owns product flows, authentication, storage providers, database state, and UI. This repository owns reusable package code that can be used by ZeroDrive and by future tools without carrying the whole app.

## Packages

```txt
packages/recovery
```

`@zerodrivehq/recovery` defines recovery manifests and restore orchestration helpers. It does not upload, download, decrypt capsules itself, or depend on a storage provider.

Planned next package:

```txt
packages/capsule
```

`@zerodrivehq/capsule` will own the portable encrypted capsule format.

## Commands

```bash
pnpm test
pnpm typecheck
pnpm build
```
