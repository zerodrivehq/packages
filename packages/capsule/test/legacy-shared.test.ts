import assert from "node:assert/strict";
import test from "node:test";

import {
  fingerprintPublicKey,
  generateRecipientKeyPair,
  isLegacySharedEnvelope,
  openLegacySharedFile,
} from "../dist/index.js";

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function postgresHex(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString("hex")}`;
}

async function createLegacyMaterial(hash: "SHA-1" | "SHA-256" = "SHA-256") {
  const pair =
    hash === "SHA-256"
      ? await generateRecipientKeyPair()
      : await (async () => {
          const generated = await crypto.subtle.generateKey(
            {
              name: "RSA-OAEP",
              modulusLength: 2048,
              publicExponent: new Uint8Array([1, 0, 1]),
              hash,
            },
            true,
            ["encrypt", "decrypt"],
          );
          return {
            publicKeyJwk: await crypto.subtle.exportKey("jwk", generated.publicKey),
            privateKeyJwk: await crypto.subtle.exportKey("jwk", generated.privateKey),
          };
        })();
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const fileKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    pair.publicKeyJwk,
    { name: "RSA-OAEP", hash },
    false,
    ["encrypt"],
  );
  const wrappedKey = new Uint8Array(
    await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawKey),
  );
  rawKey.fill(0);
  return { pair, fileKey, wrappedKey };
}

async function createZdseEnvelope(
  fileKey: CryptoKey,
  plaintext: Uint8Array,
  keyVersion: number,
): Promise<Uint8Array> {
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      name: "legacy.txt",
      mimeType: "text/plain",
      message: "existing share",
    }),
  );
  const metadataIv = crypto.getRandomValues(new Uint8Array(12));
  const contentIv = crypto.getRandomValues(new Uint8Array(12));
  const header = new Uint8Array(42);
  header.set([0x5a, 0x44, 0x53, 0x45]);
  const view = new DataView(header.buffer);
  view.setUint8(4, 1);
  view.setUint8(5, 1);
  view.setUint32(6, keyVersion);
  header.set(metadataIv, 10);
  header.set(contentIv, 22);
  view.setUint32(34, metadata.byteLength + 16);
  view.setUint32(38, plaintext.byteLength + 16);
  const [encryptedMetadata, encryptedContent] = await Promise.all([
    crypto.subtle.encrypt(
      { name: "AES-GCM", iv: metadataIv, additionalData: header },
      fileKey,
      metadata,
    ),
    crypto.subtle.encrypt(
      { name: "AES-GCM", iv: contentIv, additionalData: header },
      fileKey,
      plaintext,
    ),
  ]);
  const bytes = new Uint8Array(
    header.byteLength + encryptedMetadata.byteLength + encryptedContent.byteLength,
  );
  bytes.set(header);
  bytes.set(new Uint8Array(encryptedMetadata), header.byteLength);
  bytes.set(
    new Uint8Array(encryptedContent),
    header.byteLength + encryptedMetadata.byteLength,
  );
  return bytes;
}

test("opens existing ZDSE shares through every wrapped-key representation", async () => {
  const { pair, fileKey, wrappedKey } = await createLegacyMaterial();
  const plaintext = new TextEncoder().encode("legacy shared content");
  const encryptedFile = await createZdseEnvelope(fileKey, plaintext, 4);
  assert.equal(isLegacySharedEnvelope(encryptedFile), true);
  const fingerprint = await fingerprintPublicKey(pair.publicKeyJwk);
  const wrappedValues = [
    base64(wrappedKey),
    postgresHex(wrappedKey),
    JSON.stringify({
      v: 1,
      keyWrap: "RSA-OAEP-256",
      contentEncryption: "AES-256-GCM",
      ciphertext: base64(wrappedKey),
    }),
    JSON.stringify({
      v: 2,
      keyWrap: "RSA-OAEP-256",
      contentEncryption: "AES-256-GCM",
      recipientKeyVersion: 4,
      recipientKeyFingerprint: fingerprint,
      ciphertext: base64(wrappedKey),
    }),
  ];

  for (const wrappedFileKey of wrappedValues) {
    const opened = await openLegacySharedFile({
      encryptedFile,
      wrappedFileKey,
      privateKeyJwk: pair.privateKeyJwk,
      keyVersion: 4,
    });
    assert.deepEqual(opened.plaintext, plaintext);
    assert.deepEqual(opened.metadata, {
      name: "legacy.txt",
      mimeType: "text/plain",
      message: "existing share",
    });
  }
});

test("opens pre-ZDSE content with separately encrypted metadata", async () => {
  const { pair, fileKey, wrappedKey } = await createLegacyMaterial();
  const plaintext = new TextEncoder().encode("older shared content");
  const fileIv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedContent = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: fileIv }, fileKey, plaintext),
  );
  const encryptedFile = new Uint8Array(12 + encryptedContent.byteLength);
  encryptedFile.set(fileIv);
  encryptedFile.set(encryptedContent, 12);

  const metadataIv = crypto.getRandomValues(new Uint8Array(12));
  const metadataPlaintext = new TextEncoder().encode(
    JSON.stringify({ version: 1, name: "old.pdf", mimeType: "application/pdf" }),
  );
  const encryptedMetadataBody = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: metadataIv,
        additionalData: new TextEncoder().encode("zerodrive-share-metadata-v1"),
      },
      fileKey,
      metadataPlaintext,
    ),
  );
  const encryptedMetadata = new Uint8Array(12 + encryptedMetadataBody.byteLength);
  encryptedMetadata.set(metadataIv);
  encryptedMetadata.set(encryptedMetadataBody, 12);

  const opened = await openLegacySharedFile({
    encryptedFile,
    wrappedFileKey: base64(wrappedKey),
    privateKeyJwk: pair.privateKeyJwk,
    encryptedMetadata: base64(encryptedMetadata),
  });
  assert.deepEqual(opened.plaintext, plaintext);
  assert.deepEqual(opened.metadata, {
    name: "old.pdf",
    mimeType: "application/pdf",
  });
});

test("reads explicitly marked legacy RSA-OAEP SHA-1 keys but never emits them", async () => {
  const { pair, fileKey, wrappedKey } = await createLegacyMaterial("SHA-1");
  assert.equal(pair.privateKeyJwk.alg, "RSA-OAEP");
  const plaintext = new TextEncoder().encode("sha1 compatibility only");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, fileKey, plaintext),
  );
  const encryptedFile = new Uint8Array(12 + body.byteLength);
  encryptedFile.set(iv);
  encryptedFile.set(body, 12);

  const opened = await openLegacySharedFile({
    encryptedFile,
    wrappedFileKey: base64(wrappedKey),
    privateKeyJwk: pair.privateKeyJwk,
    fallbackMetadata: { name: "legacy.bin", mimeType: "application/octet-stream" },
  });
  assert.deepEqual(opened.plaintext, plaintext);
});
