import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CapsuleError,
  ZERO_DRIVE_FORMATS,
  createCapsule,
  createZeroDrivePersonalFileCapsule,
  createZeroDriveSharedFileCapsule,
  createZeroDriveSharedMetadataCapsule,
  createZeroDriveSharingKeyBackup,
  createZeroDriveVaultIndexCapsule,
  deriveZeroDriveLegacyVaultKey,
  fingerprintPublicKey,
  generateRecipientKeyPair,
  isCapsule,
  openZeroDrivePersonalFile,
  openZeroDriveSharedFile,
  openZeroDriveSharedMetadataCapsule,
  openZeroDriveSharingKeyBackup,
  openZeroDriveVaultIndex,
  type JsonObject,
} from "../dist/index.js";
import {
  createLegacySharedFixture,
  deriveLegacyEncryptionKey,
  encryptLegacyBytes,
} from "./zerodrive-fixtures.ts";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const WRONG_PHRASE =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

function expectCode(...codes: CapsuleError["code"][]) {
  return (error: unknown): boolean =>
    error instanceof CapsuleError && codes.includes(error.code);
}

function jsonObject(value: JsonWebKey): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["encrypt"],
  );
}

async function importPrivateKey(
  jwk: JsonWebKey,
  extractable = false,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    extractable,
    ["decrypt"],
  );
}

test("exports stable ZeroDrive format identifiers", () => {
  assert.deepEqual(ZERO_DRIVE_FORMATS, {
    CAPSULE_V1: "capsule_v1",
    LEGACY_PERSONAL_V1: "legacy_personal_v1",
    LEGACY_METADATA_V1: "legacy_metadata_v1",
    LEGACY_SHARED_ZDSE: "legacy_zdse",
    LEGACY_PRIVATE_KEY_BACKUP_V1: "legacy_private_key_backup_v1",
  });
});

test("creates and opens ZeroDrive personal capsules with app metadata", async () => {
  const content = new Uint8Array([0, 1, 2, 127, 128, 255]);
  const metadata = {
    name: "photo.raw",
    mimeType: "application/octet-stream",
    driveId: "drive-test-id",
    nested: { favorite: true },
  };
  const encryptedBytes = await createZeroDrivePersonalFileCapsule({
    content,
    metadata,
    recoveryPhrase: PHRASE,
  });
  assert.equal(isCapsule(encryptedBytes), true);

  const opened = await openZeroDrivePersonalFile({
    encryptedBytes,
    recoveryPhrase: PHRASE,
  });
  assert.deepEqual(opened.content, content);
  assert.deepEqual(opened.metadata, metadata);
  assert.equal(opened.format, ZERO_DRIVE_FORMATS.CAPSULE_V1);
  await assert.rejects(
    openZeroDrivePersonalFile({
      encryptedBytes,
      recoveryPhrase: WRONG_PHRASE,
    }),
    expectCode("CAPSULE_KEY_UNWRAP_FAILED"),
  );
});

test("opens legacy personal files with an AES key or only the phrase", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/personal-file-v1.json", import.meta.url),
      "utf8",
    ),
  ) as {
    recoveryPhrase: string;
    vectors: Array<{ encryptedBase64: string; plaintextBase64: string }>;
  };
  const vector = fixture.vectors[0]!;
  const encryptedBytes = Buffer.from(vector.encryptedBase64, "base64");
  const originalEncryptedBytes = Buffer.from(encryptedBytes);
  const expected = Buffer.from(vector.plaintextBase64, "base64");
  const legacyAesKey = await deriveZeroDriveLegacyVaultKey(
    fixture.recoveryPhrase,
  );

  for (const opened of [
    await openZeroDrivePersonalFile({ encryptedBytes, legacyAesKey }),
    await openZeroDrivePersonalFile({
      encryptedBytes,
      recoveryPhrase: fixture.recoveryPhrase,
    }),
  ]) {
    assert.deepEqual(Buffer.from(opened.content), expected);
    assert.deepEqual(opened.metadata, {});
    assert.equal(opened.format, ZERO_DRIVE_FORMATS.LEGACY_PERSONAL_V1);
  }
  assert.deepEqual(encryptedBytes, originalEncryptedBytes);
});

test("keeps generic capsule v1 files readable through the personal adapter", async () => {
  const content = new TextEncoder().encode("capsule 0.2 compatibility");
  const generic = await createCapsule({
    plaintext: content,
    metadata: {
      name: "generic.txt",
      mimeType: "text/plain",
      size: content.byteLength,
    },
    recoveryPhrase: PHRASE,
  });
  const opened = await openZeroDrivePersonalFile({
    encryptedBytes: generic.bytes,
    recoveryPhrase: PHRASE,
  });
  assert.deepEqual(opened.content, content);
  assert.deepEqual(opened.metadata, {
    name: "generic.txt",
    mimeType: "text/plain",
    size: content.byteLength,
  });
});

test("creates and opens capsule and legacy vault indexes", async () => {
  const index = {
    files: [{ id: "one", name: "hello.txt", size: 5 }],
    folders: [],
    revision: 4,
  };
  const capsule = await createZeroDriveVaultIndexCapsule({
    index,
    recoveryPhrase: PHRASE,
  });
  const openedCapsule = await openZeroDriveVaultIndex({
    encryptedBytes: capsule,
    recoveryPhrase: PHRASE,
  });
  assert.deepEqual(openedCapsule.index, index);
  assert.equal(openedCapsule.format, ZERO_DRIVE_FORMATS.CAPSULE_V1);
  await assert.rejects(
    openZeroDriveVaultIndex({
      encryptedBytes: capsule,
      recoveryPhrase: WRONG_PHRASE,
    }),
    expectCode("CAPSULE_KEY_UNWRAP_FAILED"),
  );

  const plaintext = new TextEncoder().encode(JSON.stringify(index));
  const encryptionKey = await deriveLegacyEncryptionKey(PHRASE);
  const legacy = await encryptLegacyBytes(plaintext, encryptionKey);
  plaintext.fill(0);
  const openedLegacy = await openZeroDriveVaultIndex({
    encryptedBytes: legacy,
    recoveryPhrase: PHRASE,
  });
  assert.deepEqual(openedLegacy.index, index);
  assert.equal(
    openedLegacy.format,
    ZERO_DRIVE_FORMATS.LEGACY_METADATA_V1,
  );
  const legacyAesKey = await deriveZeroDriveLegacyVaultKey(PHRASE);
  assert.deepEqual(
    (
      await openZeroDriveVaultIndex({
        encryptedBytes: legacy,
        legacyAesKey,
      })
    ).index,
    index,
  );
  await assert.rejects(
    openZeroDriveVaultIndex({
      encryptedBytes: legacy,
      recoveryPhrase: WRONG_PHRASE,
    }),
    expectCode("DECRYPTION_FAILED"),
  );
});

test("creates and opens shared capsules directly with recipient JWKs", async () => {
  const [recipient, wrongRecipient] = await Promise.all([
    generateRecipientKeyPair(),
    generateRecipientKeyPair(),
  ]);
  const privateKey = await importPrivateKey(recipient.privateKeyJwk);
  const fingerprint = await fingerprintPublicKey(recipient.publicKeyJwk);
  const content = new TextEncoder().encode("new shared capsule");
  const metadata = {
    name: "shared.txt",
    mimeType: "text/plain",
    message: "hello",
  };
  const capsule = await createZeroDriveSharedFileCapsule({
    content,
    metadata,
    recipients: [
      {
        publicKeyJwk: jsonObject(recipient.publicKeyJwk),
        fingerprint,
        keyVersion: 6,
      },
    ],
  });
  const opened = await openZeroDriveSharedFile({
    encryptedBytes: capsule,
    recipientPrivateKeyJwks: [
      { privateKeyJwk: jsonObject(recipient.privateKeyJwk) },
    ],
  });
  assert.deepEqual(opened.content, content);
  assert.deepEqual(opened.metadata, metadata);
  assert.equal(opened.format, ZERO_DRIVE_FORMATS.CAPSULE_V1);

  const openedWithCryptoKey = await openZeroDriveSharedFile({
    encryptedBytes: capsule,
    recipientPrivateKeys: [privateKey],
  });
  assert.deepEqual(openedWithCryptoKey.content, content);

  await assert.rejects(
    openZeroDriveSharedFile({
      encryptedBytes: capsule,
      recipientPrivateKeyJwks: [
        { privateKeyJwk: jsonObject(wrongRecipient.privateKeyJwk) },
      ],
    }),
    expectCode("CAPSULE_NO_MATCHING_KEY"),
  );
});

test("creates and opens small shared metadata capsules", async () => {
  const [recipient, wrongRecipient] = await Promise.all([
    generateRecipientKeyPair(),
    generateRecipientKeyPair(),
  ]);
  const fingerprint = await fingerprintPublicKey(recipient.publicKeyJwk);
  const metadata = {
    name: "inbox-photo.png",
    mimeType: "image/png",
    message: "private hello",
  };
  const capsule = await createZeroDriveSharedMetadataCapsule({
    metadata,
    recipients: [
      {
        publicKeyJwk: jsonObject(recipient.publicKeyJwk),
        fingerprint,
        keyVersion: 4,
      },
    ],
  });
  const opened = await openZeroDriveSharedMetadataCapsule({
    encryptedBytes: capsule,
    recipientPrivateKeyJwks: [
      { privateKeyJwk: jsonObject(recipient.privateKeyJwk) },
    ],
  });
  assert.deepEqual(opened.metadata, metadata);
  assert.equal(opened.format, ZERO_DRIVE_FORMATS.CAPSULE_V1);

  await assert.rejects(
    openZeroDriveSharedMetadataCapsule({
      encryptedBytes: capsule,
      recipientPrivateKeyJwks: [
        { privateKeyJwk: jsonObject(wrongRecipient.privateKeyJwk) },
      ],
    }),
    expectCode("CAPSULE_NO_MATCHING_KEY"),
  );
});

test("opens legacy ZDSE and pre-ZDSE shares through the high-level API", async () => {
  const recipient = await generateRecipientKeyPair();
  const publicKey = await importPublicKey(recipient.publicKeyJwk);
  const fingerprint = await fingerprintPublicKey(recipient.publicKeyJwk);

  for (const preZdse of [false, true]) {
    const fixture = await createLegacySharedFixture({
      publicKey,
      keyVersion: 3,
      fingerprint,
      preZdse,
    });
    const opened = await openZeroDriveSharedFile({
      encryptedBytes: fixture.encryptedBytes,
      recipientPrivateKeyJwks: [
        {
          privateKeyJwk: jsonObject(recipient.privateKeyJwk),
          keyVersion: 3,
        },
      ],
      legacy: {
        encryptedFileKey: fixture.encryptedFileKey,
        ...(fixture.encryptedMetadata === undefined
          ? {}
          : { encryptedMetadata: fixture.encryptedMetadata }),
      },
    });
    assert.deepEqual(opened.content, fixture.content);
    assert.deepEqual(opened.metadata, fixture.metadata);
    assert.equal(opened.format, ZERO_DRIVE_FORMATS.LEGACY_SHARED_ZDSE);

    if (fixture.encryptedMetadata !== undefined) {
      const openedMetadata = await openZeroDriveSharedMetadataCapsule({
        encryptedBytes: new Uint8Array(0),
        recipientPrivateKeyJwks: [
          {
            privateKeyJwk: jsonObject(recipient.privateKeyJwk),
            keyVersion: 3,
          },
        ],
        legacy: {
          encryptedFileKey: fixture.encryptedFileKey,
          encryptedMetadata: fixture.encryptedMetadata,
        },
      });
      assert.deepEqual(openedMetadata.metadata, fixture.metadata);
      assert.equal(
        openedMetadata.format,
        ZERO_DRIVE_FORMATS.LEGACY_SHARED_ZDSE,
      );
    }
  }
});

test("imports explicitly marked SHA-1 legacy private JWKs internally", async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-1",
    },
    true,
    ["encrypt", "decrypt"],
  );
  const [publicKeyJwk, privateKeyJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.publicKey),
    crypto.subtle.exportKey("jwk", pair.privateKey),
  ]);
  assert.equal(privateKeyJwk.alg, "RSA-OAEP");
  const fixture = await createLegacySharedFixture({
    publicKey: pair.publicKey,
    keyVersion: 2,
    fingerprint: await fingerprintPublicKey(publicKeyJwk),
    wrappedKeyFormat: "raw",
  });

  const opened = await openZeroDriveSharedFile({
    encryptedBytes: fixture.encryptedBytes,
    recipientPrivateKeyJwks: [
      { privateKeyJwk: jsonObject(privateKeyJwk), keyVersion: 2 },
    ],
    legacy: { encryptedFileKey: fixture.encryptedFileKey },
  });
  assert.deepEqual(opened.content, fixture.content);
  assert.deepEqual(opened.metadata, fixture.metadata);
});

test("creates and opens versioned sharing-key backup capsules", async () => {
  const pair = await generateRecipientKeyPair();
  const fingerprint = await fingerprintPublicKey(pair.publicKeyJwk);
  const encryptedBytes = await createZeroDriveSharingKeyBackup({
    privateKeyJwk: jsonObject(pair.privateKeyJwk),
    publicKeyJwk: jsonObject(pair.publicKeyJwk),
    recoveryPhrase: PHRASE,
    keyVersion: 9,
    fingerprint,
  });
  const opened = await openZeroDriveSharingKeyBackup({
    encryptedBytes,
    recoveryPhrase: PHRASE,
  });
  assert.equal(opened.privateKeyJwk.d, pair.privateKeyJwk.d);
  assert.equal(opened.publicKeyJwk?.n, pair.publicKeyJwk.n);
  assert.equal(opened.keyVersion, 9);
  assert.equal(opened.fingerprint, fingerprint);
  assert.equal(opened.format, ZERO_DRIVE_FORMATS.CAPSULE_V1);
  await assert.rejects(
    openZeroDriveSharingKeyBackup({
      encryptedBytes,
      recoveryPhrase: WRONG_PHRASE,
    }),
    expectCode("CAPSULE_KEY_UNWRAP_FAILED"),
  );
});

test("opens legacy IndexedDB PBKDF2 sharing-key records", async () => {
  const pair = await generateRecipientKeyPair();
  const salt = "legacy-indexeddb-salt";
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(PHRASE),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const wrappingKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    encoder.encode(JSON.stringify(pair.privateKeyJwk)),
  );
  const encryptedBytes = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  encryptedBytes.set(iv);
  encryptedBytes.set(new Uint8Array(ciphertext), iv.byteLength);

  const opened = await openZeroDriveSharingKeyBackup({
    encryptedBytes,
    recoveryPhrase: PHRASE,
    legacyPbkdf2Salt: salt,
    legacyKeyVersion: 7,
  });
  assert.equal(opened.privateKeyJwk.d, pair.privateKeyJwk.d);
  assert.equal(opened.keyVersion, 7);
  assert.equal(opened.format, ZERO_DRIVE_FORMATS.LEGACY_PRIVATE_KEY_BACKUP_V1);
});

test("opens legacy Google Drive sharing-key backups", async () => {
  const pair = await generateRecipientKeyPair();
  const legacyJwk = { ...pair.privateKeyJwk, alg: "RSA-OAEP" };
  const plaintext = new TextEncoder().encode(JSON.stringify(legacyJwk));
  const key = await deriveLegacyEncryptionKey(PHRASE);
  const encryptedBytes = await encryptLegacyBytes(plaintext, key, 23);
  plaintext.fill(0);

  const opened = await openZeroDriveSharingKeyBackup({
    encryptedBytes,
    recoveryPhrase: PHRASE,
  });
  assert.equal(opened.privateKeyJwk.d, pair.privateKeyJwk.d);
  assert.equal(opened.keyVersion, 1);
  assert.equal(
    opened.format,
    ZERO_DRIVE_FORMATS.LEGACY_PRIVATE_KEY_BACKUP_V1,
  );
});

test("does not misclassify random legacy bytes as capsules", async () => {
  const random = crypto.getRandomValues(new Uint8Array(64));
  assert.equal(isCapsule(random), false);
  await assert.rejects(
    openZeroDrivePersonalFile({
      encryptedBytes: random,
      recoveryPhrase: PHRASE,
    }),
    expectCode("DECRYPTION_FAILED"),
  );
});
