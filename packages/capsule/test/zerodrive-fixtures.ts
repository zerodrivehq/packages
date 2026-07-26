import { mnemonicToSeedWebcrypto } from "@scure/bip39";

const SHARED_METADATA_AAD = new TextEncoder().encode(
  "zerodrive-share-metadata-v1",
);

export async function deriveLegacyEncryptionKey(
  recoveryPhrase: string,
): Promise<CryptoKey> {
  const seed = await mnemonicToSeedWebcrypto(recoveryPhrase);
  const keyBytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", seed),
  );
  try {
    return await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
  } finally {
    seed.fill(0);
    keyBytes.fill(0);
  }
}

export async function encryptLegacyBytes(
  plaintext: Uint8Array,
  key: CryptoKey,
  ivByte = 7,
): Promise<Uint8Array> {
  const iv = new Uint8Array(12).fill(ivByte);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  const encrypted = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  encrypted.set(iv);
  encrypted.set(ciphertext, iv.byteLength);
  return encrypted;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export async function createLegacySharedFixture(input: {
  publicKey: CryptoKey;
  keyVersion: number;
  fingerprint: string;
  preZdse?: boolean;
  wrappedKeyFormat?: "raw" | "v2";
}): Promise<{
  encryptedBytes: Uint8Array;
  encryptedFileKey: string;
  encryptedMetadata?: string;
  content: Uint8Array;
  metadata: {
    name: string;
    mimeType: string;
    message: string;
  };
}> {
  const rawKey = Uint8Array.from(
    { length: 32 },
    (_, index) => index + 1,
  );
  const fileKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const wrappedKey = new Uint8Array(
    await crypto.subtle.encrypt({ name: "RSA-OAEP" }, input.publicKey, rawKey),
  );
  rawKey.fill(0);
  const content = new TextEncoder().encode(
    input.preZdse ? "pre-ZDSE shared file" : "ZDSE shared file",
  );
  const metadata = {
    name: input.preZdse ? "older.pdf" : "shared.txt",
    mimeType: input.preZdse ? "application/pdf" : "text/plain",
    message: "test fixture",
  };
  const serializedMetadata = new TextEncoder().encode(
    JSON.stringify({ version: 1, ...metadata }),
  );

  const encryptedFileKey =
    input.wrappedKeyFormat === "raw"
      ? bytesToBase64(wrappedKey)
      : JSON.stringify({
          v: 2,
          keyWrap: "RSA-OAEP-256",
          contentEncryption: "AES-256-GCM",
          recipientKeyVersion: input.keyVersion,
          recipientKeyFingerprint: input.fingerprint,
          ciphertext: bytesToBase64(wrappedKey),
        });

  if (input.preZdse === true) {
    const fileIv = new Uint8Array(12).fill(11);
    const encryptedContent = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: fileIv },
        fileKey,
        content,
      ),
    );
    const encryptedBytes = new Uint8Array(
      fileIv.byteLength + encryptedContent.byteLength,
    );
    encryptedBytes.set(fileIv);
    encryptedBytes.set(encryptedContent, fileIv.byteLength);

    const metadataIv = new Uint8Array(12).fill(13);
    const metadataCiphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: metadataIv,
          additionalData: SHARED_METADATA_AAD,
        },
        fileKey,
        serializedMetadata,
      ),
    );
    const encryptedMetadata = new Uint8Array(
      metadataIv.byteLength + metadataCiphertext.byteLength,
    );
    encryptedMetadata.set(metadataIv);
    encryptedMetadata.set(metadataCiphertext, metadataIv.byteLength);
    return {
      encryptedBytes,
      encryptedFileKey,
      encryptedMetadata: bytesToBase64(encryptedMetadata),
      content,
      metadata,
    };
  }

  const metadataIv = new Uint8Array(12).fill(17);
  const contentIv = new Uint8Array(12).fill(19);
  const header = new Uint8Array(42);
  header.set([0x5a, 0x44, 0x53, 0x45]);
  const view = new DataView(header.buffer);
  view.setUint8(4, 1);
  view.setUint8(5, 1);
  view.setUint32(6, input.keyVersion);
  header.set(metadataIv, 10);
  header.set(contentIv, 22);
  view.setUint32(34, serializedMetadata.byteLength + 16);
  view.setUint32(38, content.byteLength + 16);
  const [metadataCiphertext, contentCiphertext] = await Promise.all([
    crypto.subtle.encrypt(
      { name: "AES-GCM", iv: metadataIv, additionalData: header },
      fileKey,
      serializedMetadata,
    ),
    crypto.subtle.encrypt(
      { name: "AES-GCM", iv: contentIv, additionalData: header },
      fileKey,
      content,
    ),
  ]);
  const encryptedBytes = new Uint8Array(
    header.byteLength +
      metadataCiphertext.byteLength +
      contentCiphertext.byteLength,
  );
  encryptedBytes.set(header);
  encryptedBytes.set(new Uint8Array(metadataCiphertext), header.byteLength);
  encryptedBytes.set(
    new Uint8Array(contentCiphertext),
    header.byteLength + metadataCiphertext.byteLength,
  );
  return { encryptedBytes, encryptedFileKey, content, metadata };
}
