import { base64ToBytes } from "./encoding.js";
import { CapsuleError } from "./errors.js";
import {
  fingerprintPublicKey,
  importRecipientPrivateKey,
} from "./keys.js";
import type {
  OpenedLegacySharedFile,
  OpenLegacySharedFileInput,
} from "./types.js";

const SHARED_MAGIC = new Uint8Array([0x5a, 0x44, 0x53, 0x45]);
const SHARED_HEADER_BYTES = 42;
const SHARED_METADATA_AAD = new TextEncoder().encode(
  "zerodrive-share-metadata-v1",
);

interface ParsedWrappedKey {
  ciphertext: Uint8Array<ArrayBuffer>;
  keyVersion?: number;
  fingerprint?: string;
}

function hasSharedMagic(bytes: Uint8Array): boolean {
  return SHARED_MAGIC.every((value, index) => bytes[index] === value);
}

export function isLegacySharedEnvelope(bytes: Uint8Array): boolean {
  return bytes.byteLength >= SHARED_MAGIC.byteLength && hasSharedMagic(bytes);
}

function parseWrappedKey(value: string): ParsedWrappedKey {
  if (value.startsWith("\\x")) {
    const hex = value.slice(2);
    if (!/^[0-9a-f]+$/iu.test(hex) || hex.length % 2 !== 0) {
      throw new CapsuleError(
        "LEGACY_SHARED_FILE_INVALID",
        "Legacy wrapped key is malformed",
      );
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < hex.length; index += 2) {
      bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
    }
    return { ciphertext: bytes };
  }
  if (!value.trim().startsWith("{")) {
    return { ciphertext: base64ToBytes(value) };
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(value);
  } catch {
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Wrapped-key envelope is malformed",
    );
  }
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    Array.isArray(envelope)
  ) {
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Wrapped-key envelope is malformed",
    );
  }
  const object = envelope as Record<string, unknown>;
  if (
    (object.v !== 1 && object.v !== 2) ||
    object.keyWrap !== "RSA-OAEP-256" ||
    object.contentEncryption !== "AES-256-GCM" ||
    typeof object.ciphertext !== "string"
  ) {
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Wrapped-key envelope is unsupported",
    );
  }
  if (object.v === 1) return { ciphertext: base64ToBytes(object.ciphertext) };
  if (
    !Number.isInteger(object.recipientKeyVersion) ||
    (object.recipientKeyVersion as number) <= 0 ||
    typeof object.recipientKeyFingerprint !== "string"
  ) {
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Wrapped-key recipient metadata is malformed",
    );
  }
  return {
    ciphertext: base64ToBytes(object.ciphertext),
    keyVersion: object.recipientKeyVersion as number,
    fingerprint: object.recipientKeyFingerprint,
  };
}

function parseSharedMetadata(value: unknown): {
  name: string;
  mimeType: string;
  message?: string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Legacy shared metadata is malformed",
    );
  }
  const metadata = value as Record<string, unknown>;
  if (
    metadata.version !== 1 ||
    typeof metadata.name !== "string" ||
    typeof metadata.mimeType !== "string"
  ) {
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Legacy shared metadata is unsupported",
    );
  }
  return {
    name: metadata.name,
    mimeType: metadata.mimeType,
    ...(typeof metadata.message === "string"
      ? { message: metadata.message }
      : {}),
  };
}

async function decryptSeparateMetadata(
  encryptedMetadata: string,
  fileKey: CryptoKey,
): Promise<{ name: string; mimeType: string; message?: string }> {
  const encrypted = base64ToBytes(encryptedMetadata);
  if (encrypted.byteLength < 28) {
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Legacy shared metadata is truncated",
    );
  }
  let plaintext: Uint8Array | undefined;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: encrypted.slice(0, 12),
          additionalData: SHARED_METADATA_AAD,
        },
        fileKey,
        encrypted.slice(12),
      ),
    );
    return parseSharedMetadata(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
    );
  } catch (error) {
    if (error instanceof CapsuleError) throw error;
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Legacy shared metadata could not be decrypted",
    );
  } finally {
    encrypted.fill(0);
    plaintext?.fill(0);
  }
}

async function decryptSharedEnvelope(
  encrypted: Uint8Array,
  fileKey: CryptoKey,
  expectedKeyVersion?: number,
): Promise<OpenedLegacySharedFile> {
  if (encrypted.byteLength < SHARED_HEADER_BYTES) {
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Legacy shared envelope is truncated",
    );
  }
  const header = encrypted.slice(0, SHARED_HEADER_BYTES);
  const view = new DataView(header.buffer);
  if (view.getUint8(4) !== 1 || view.getUint8(5) !== 1) {
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Legacy shared envelope version is unsupported",
    );
  }
  const keyVersion = view.getUint32(6);
  if (expectedKeyVersion !== undefined && keyVersion !== expectedKeyVersion) {
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Legacy shared recipient key version does not match",
    );
  }
  const metadataLength = view.getUint32(34);
  const contentLength = view.getUint32(38);
  if (
    metadataLength < 17 ||
    contentLength < 16 ||
    SHARED_HEADER_BYTES + metadataLength + contentLength !== encrypted.byteLength
  ) {
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Legacy shared envelope lengths are malformed",
    );
  }
  const metadataCiphertext = encrypted.slice(
    SHARED_HEADER_BYTES,
    SHARED_HEADER_BYTES + metadataLength,
  );
  const contentCiphertext = encrypted.slice(SHARED_HEADER_BYTES + metadataLength);
  let metadataPlaintext: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  try {
    const [metadata, content] = await Promise.all([
      crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: header.slice(10, 22),
          additionalData: header,
        },
        fileKey,
        metadataCiphertext,
      ),
      crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: header.slice(22, 34),
          additionalData: header,
        },
        fileKey,
        contentCiphertext,
      ),
    ]);
    metadataPlaintext = new Uint8Array(metadata);
    plaintext = new Uint8Array(content);
    const result = {
      plaintext,
      metadata: parseSharedMetadata(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(metadataPlaintext),
        ),
      ),
    };
    plaintext = undefined;
    return result;
  } catch (error) {
    if (error instanceof CapsuleError) throw error;
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Legacy shared envelope could not be decrypted",
    );
  } finally {
    header.fill(0);
    metadataCiphertext.fill(0);
    contentCiphertext.fill(0);
    metadataPlaintext?.fill(0);
    plaintext?.fill(0);
  }
}

export async function openLegacySharedFile(
  input: OpenLegacySharedFileInput,
): Promise<OpenedLegacySharedFile> {
  const wrapped = parseWrappedKey(input.wrappedFileKey);
  try {
    if (
      wrapped.keyVersion !== undefined &&
      input.keyVersion !== undefined &&
      wrapped.keyVersion !== input.keyVersion
    ) {
      throw new CapsuleError(
        "LEGACY_SHARED_FILE_INVALID",
        "Legacy wrapped-key version does not match",
      );
    }
    if (wrapped.fingerprint !== undefined) {
      const fingerprint = await fingerprintPublicKey(input.privateKeyJwk);
      if (fingerprint !== wrapped.fingerprint) {
        throw new CapsuleError(
          "LEGACY_SHARED_FILE_INVALID",
          "Legacy wrapped-key fingerprint does not match",
        );
      }
    }
    const hash =
      input.privateKeyJwk.alg === "RSA-OAEP" ||
      input.privateKeyJwk.alg === "RSA-OAEP-1"
        ? "SHA-1"
        : "SHA-256";
    const privateKey = await importRecipientPrivateKey(input.privateKeyJwk, hash);
    let rawKey: Uint8Array | undefined;
    try {
      rawKey = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "RSA-OAEP" },
          privateKey,
          wrapped.ciphertext,
        ),
      );
      if (rawKey.byteLength !== 32) throw new Error("invalid key length");
      const keyBytes = Uint8Array.from(rawKey);
      try {
        const fileKey = await crypto.subtle.importKey(
          "raw",
          keyBytes,
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"],
        );
        if (isLegacySharedEnvelope(input.encryptedFile)) {
          return await decryptSharedEnvelope(
            input.encryptedFile,
            fileKey,
            input.keyVersion ?? wrapped.keyVersion,
          );
        }
        if (input.encryptedFile.byteLength < 28) {
          throw new CapsuleError(
            "LEGACY_SHARED_FILE_INVALID",
            "Legacy shared file is truncated",
          );
        }
        let plaintext: Uint8Array | undefined;
        try {
          plaintext = new Uint8Array(
            await crypto.subtle.decrypt(
              { name: "AES-GCM", iv: input.encryptedFile.slice(0, 12) },
              fileKey,
              input.encryptedFile.slice(12),
            ),
          );
          const metadata = input.encryptedMetadata
            ? await decryptSeparateMetadata(input.encryptedMetadata, fileKey)
            : {
                name: input.fallbackMetadata?.name ?? "recovered-file",
                mimeType:
                  input.fallbackMetadata?.mimeType ?? "application/octet-stream",
              };
          const result = { plaintext, metadata };
          plaintext = undefined;
          return result;
        } finally {
          plaintext?.fill(0);
        }
      } finally {
        keyBytes.fill(0);
      }
    } catch (error) {
      if (error instanceof CapsuleError) throw error;
      throw new CapsuleError(
        "LEGACY_SHARED_FILE_INVALID",
        "Legacy shared file could not be opened",
      );
    } finally {
      rawKey?.fill(0);
    }
  } finally {
    wrapped.ciphertext.fill(0);
  }
}
