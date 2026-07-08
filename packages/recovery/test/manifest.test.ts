import assert from "node:assert/strict";
import test from "node:test";
import {
  RecoveryError,
  createRecoveryManifest,
  parseRecoveryManifest,
  readRecoveryManifest,
  serializeRecoveryManifest,
  summarizeRecoveryManifest,
  validateRecoveryManifest,
} from "../src/index.ts";

const item = {
  id: "item_01",
  type: "personal-file",
  capsulePath: "objects/item_01.zdcapsule",
  encryptedSize: 42,
  metadata: { encrypted: true },
} as const;

test("createRecoveryManifest creates a valid v1 manifest", () => {
  const manifest = createRecoveryManifest({
    createdAt: "2026-07-09T00:00:00.000Z",
    items: [item],
  });

  assert.equal(manifest.version, 1);
  assert.equal(manifest.app, "zerodrive");
  assert.equal(manifest.items[0]?.id, "item_01");
});

test("parseRecoveryManifest accepts JSON bytes", () => {
  const manifest = createRecoveryManifest({
    createdAt: "2026-07-09T00:00:00.000Z",
    items: [item],
  });
  const bytes = new TextEncoder().encode(serializeRecoveryManifest(manifest));

  assert.deepEqual(parseRecoveryManifest(bytes), manifest);
  assert.deepEqual(readRecoveryManifest(bytes), manifest);
});

test("validateRecoveryManifest rejects unsafe capsule paths", () => {
  for (const capsulePath of [
    "../secrets/plaintext.txt",
    "C:/tmp/file.zdcapsule",
    "C:\\tmp\\file.zdcapsule",
    "C:tmp/file.zdcapsule",
  ]) {
    const result = validateRecoveryManifest({
      version: 1,
      app: "zerodrive",
      createdAt: "2026-07-09T00:00:00.000Z",
      items: [
        {
          ...item,
          capsulePath,
        },
      ],
    });

    assert.equal(result.ok, false);
    assert.match(result.issues[0]?.message || "", /safe relative path/);
  }
});

test("validateRecoveryManifest rejects duplicate item ids", () => {
  const result = validateRecoveryManifest({
    version: 1,
    app: "zerodrive",
    createdAt: "2026-07-09T00:00:00.000Z",
    items: [item, item],
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.at(-1)?.message, "item id must be unique");
});

test("validateRecoveryManifest rejects malformed key hints", () => {
  const result = validateRecoveryManifest({
    version: 1,
    app: "zerodrive",
    createdAt: "2026-07-09T00:00:00.000Z",
    items: [
      {
        ...item,
        keyHint: {
          kind: "recipient-private-key",
          keyVersion: 0,
          publicKeyFingerprint: "bad",
        },
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 2);
  assert.equal(
    result.issues[0]?.message,
    "keyHint.keyVersion must be a positive safe integer",
  );
});

test("parseRecoveryManifest throws a typed error for unsupported versions", () => {
  assert.throws(
    () =>
      parseRecoveryManifest(
        JSON.stringify({
          version: 2,
          app: "zerodrive",
          createdAt: "2026-07-09T00:00:00.000Z",
          items: [],
        }),
      ),
    (error: unknown) =>
      error instanceof RecoveryError &&
      error.code === "RECOVERY_MANIFEST_UNSUPPORTED_VERSION",
  );
});

test("summarizeRecoveryManifest reports counts and encrypted bytes", () => {
  const manifest = createRecoveryManifest({
    createdAt: "2026-07-09T00:00:00.000Z",
    items: [
      item,
      {
        id: "item_02",
        type: "shared-file",
        capsulePath: "objects/item_02.zdcapsule",
        encryptedSize: 100,
        metadata: { encrypted: true },
      },
    ],
  });

  assert.deepEqual(summarizeRecoveryManifest(manifest), {
    version: 1,
    app: "zerodrive",
    createdAt: "2026-07-09T00:00:00.000Z",
    totalItems: 2,
    itemTypes: {
      "personal-file": 1,
      "shared-file": 1,
      "private-key-backup": 0,
    },
    encryptedBytes: 142,
  });
});
