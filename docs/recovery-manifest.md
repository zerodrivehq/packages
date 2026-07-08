# Recovery manifest v1

The recovery manifest is a small map of encrypted objects that may be restored later by a compatible tool.

The manifest must not be treated as a place for plaintext sensitive metadata. It can describe where encrypted capsules live and which broad kind of item each capsule represents, but filenames, messages, MIME types, and other user-readable metadata should normally remain inside the encrypted capsule.

## Shape

```json
{
  "version": 1,
  "createdAt": "2026-07-09T00:00:00.000Z",
  "app": "zerodrive",
  "items": [
    {
      "id": "item_01",
      "type": "personal-file",
      "capsulePath": "objects/item_01.zdcapsule",
      "metadata": {
        "encrypted": true
      }
    }
  ]
}
```

## Path rules

`capsulePath` is a manifest-relative path. It must not be absolute and must not contain `.` or `..` path segments. Recovery tools should resolve it against an explicit backup root instead of trusting it as a filesystem path.

## Package boundary

`@zerodrivehq/recovery` validates manifests and coordinates restore attempts. It does not fetch objects from a cloud provider and does not decrypt capsules directly. Callers provide encrypted capsule bytes and an opener function, which will later be backed by `@zerodrivehq/capsule`.
