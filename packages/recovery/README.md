# @zerodrivehq/recovery

Backup and restore helpers for ZeroDrive recovery flows.

This package defines the recovery manifest format and pure restore orchestration. It deliberately avoids:

- cloud provider clients
- filesystem access
- application routes
- UI
- direct capsule decryption

Callers provide encrypted capsule bytes and an opener function. The opener can later be implemented with `@zerodrivehq/capsule`.
