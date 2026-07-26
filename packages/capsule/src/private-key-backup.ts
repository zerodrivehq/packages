import { createCapsule, openCapsule } from "./capsule.js";
import { CapsuleError } from "./errors.js";
import {
  fingerprintPublicKey,
  importRecipientPublicKey,
  importRecipientPrivateKey,
  assertPositiveKeyVersion,
} from "./keys.js";
import { decryptPersonalFileWithRecoveryPhrase } from "./personal-file.js";
import { copyBytes, stableStringify } from "./encoding.js";
import type {
  CreatePrivateKeyBackupInput,
  CreatedCapsule,
  OpenPrivateKeyBackupInput,
  OpenedPrivateKeyBackup,
} from "./types.js";

async function validatePrivateKey(
  value: unknown,
  keyVersion: number,
  allowLegacySha1 = false,
): Promise<{ privateKeyJwk: JsonWebKey; fingerprint: string }> {
  assertPositiveKeyVersion(keyVersion);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CapsuleError(
      "CAPSULE_KEY_INVALID",
      "Private-key backup does not contain a JWK",
    );
  }
  const privateKeyJwk = value as JsonWebKey;
  const hash =
    allowLegacySha1 &&
    (privateKeyJwk.alg === "RSA-OAEP" || privateKeyJwk.alg === "RSA-OAEP-1")
      ? "SHA-1"
      : "SHA-256";
  await importRecipientPrivateKey(privateKeyJwk, hash);
  return {
    privateKeyJwk,
    fingerprint: await fingerprintPublicKey(privateKeyJwk),
  };
}

async function validatePublicKey(
  value: unknown,
  expectedFingerprint: string,
): Promise<JsonWebKey> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CapsuleError(
      "CAPSULE_KEY_INVALID",
      "Private-key backup public JWK is malformed",
    );
  }
  const publicKeyJwk = value as JsonWebKey;
  if (typeof publicKeyJwk.d === "string") {
    throw new CapsuleError(
      "CAPSULE_KEY_INVALID",
      "Private-key backup public JWK contains private material",
    );
  }
  await importRecipientPublicKey(publicKeyJwk);
  if (await fingerprintPublicKey(publicKeyJwk) !== expectedFingerprint) {
    throw new CapsuleError(
      "CAPSULE_KEY_INVALID",
      "Private-key backup public key does not match",
    );
  }
  return publicKeyJwk;
}

export async function createPrivateKeyBackupCapsule(
  input: CreatePrivateKeyBackupInput,
): Promise<CreatedCapsule> {
  const { privateKeyJwk, fingerprint } = await validatePrivateKey(
    input.privateKeyJwk,
    input.keyVersion,
  );
  if (
    input.fingerprint !== undefined &&
    input.fingerprint !== fingerprint
  ) {
    throw new CapsuleError(
      "CAPSULE_KEY_INVALID",
      "Private-key backup fingerprint does not match",
    );
  }
  let publicKeyJwk: JsonWebKey | undefined;
  if (input.publicKeyJwk !== undefined) {
    publicKeyJwk = await validatePublicKey(input.publicKeyJwk, fingerprint);
  }
  const payload =
    publicKeyJwk === undefined
      ? privateKeyJwk
      : { version: 1, privateKeyJwk, publicKeyJwk };
  const plaintext = new TextEncoder().encode(stableStringify(payload));
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    plaintext.fill(0);
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "Private-key backup timestamp is invalid",
    );
  }
  try {
    return await createCapsule({
      plaintext,
      recoveryPhrase: input.recoveryPhrase,
      metadata: {
        name: "zerodrive-rsa-private-key.json",
        mimeType: "application/jwk+json",
        size: plaintext.byteLength,
        createdAt,
        attributes: {
          kind: "private-key-backup",
          keyVersion: input.keyVersion,
          fingerprint,
          ...(publicKeyJwk === undefined ? {} : { payloadVersion: 1 }),
        },
      },
    });
  } finally {
    plaintext.fill(0);
  }
}

export async function openPrivateKeyBackupCapsule(
  input: OpenPrivateKeyBackupInput,
): Promise<OpenedPrivateKeyBackup> {
  const opened = await openCapsule({
    capsule: input.capsule,
    recoveryPhrase: input.recoveryPhrase,
  });
  try {
    const attributes = opened.metadata.attributes;
    if (
      attributes?.kind !== "private-key-backup" ||
      typeof attributes.keyVersion !== "number" ||
      typeof attributes.fingerprint !== "string"
    ) {
      throw new CapsuleError(
        "CAPSULE_METADATA_INVALID",
        "Capsule is not a private-key backup",
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(opened.plaintext),
      );
    } catch {
      throw new CapsuleError(
        "CAPSULE_KEY_INVALID",
        "Private-key backup JWK is malformed",
      );
    }
    let privateKeyValue = value;
    let publicKeyValue: unknown;
    if (attributes.payloadVersion === 1) {
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        (value as Record<string, unknown>).version !== 1
      ) {
        throw new CapsuleError(
          "CAPSULE_KEY_INVALID",
          "Private-key backup payload is malformed",
        );
      }
      const payload = value as Record<string, unknown>;
      privateKeyValue = payload.privateKeyJwk;
      publicKeyValue = payload.publicKeyJwk;
    } else if (attributes.payloadVersion !== undefined) {
      throw new CapsuleError(
        "CAPSULE_KEY_INVALID",
        "Private-key backup payload version is unsupported",
      );
    }
    const validated = await validatePrivateKey(
      privateKeyValue,
      attributes.keyVersion,
    );
    if (validated.fingerprint !== attributes.fingerprint) {
      throw new CapsuleError(
        "CAPSULE_KEY_INVALID",
        "Private-key backup fingerprint does not match",
      );
    }
    const publicKeyJwk =
      publicKeyValue === undefined
        ? undefined
        : await validatePublicKey(publicKeyValue, validated.fingerprint);
    return {
      privateKeyJwk: validated.privateKeyJwk,
      ...(publicKeyJwk === undefined ? {} : { publicKeyJwk }),
      keyVersion: attributes.keyVersion,
      fingerprint: validated.fingerprint,
    };
  } finally {
    opened.plaintext.fill(0);
  }
}

export async function openLegacyPrivateKeyBackup(
  encryptedBytes: Uint8Array,
  recoveryPhrase: string,
  keyVersion = 1,
): Promise<OpenedPrivateKeyBackup> {
  const plaintext = await decryptPersonalFileWithRecoveryPhrase(
    encryptedBytes,
    recoveryPhrase,
  );
  try {
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
      );
    } catch {
      throw new CapsuleError(
        "CAPSULE_KEY_INVALID",
        "Legacy private-key backup JWK is malformed",
      );
    }
    const validated = await validatePrivateKey(value, keyVersion, true);
    return { ...validated, keyVersion };
  } finally {
    plaintext.fill(0);
  }
}

export async function openLegacyPbkdf2PrivateKeyBackup(
  encryptedBytes: Uint8Array,
  recoveryPhrase: string,
  salt: string,
  keyVersion = 1,
): Promise<OpenedPrivateKeyBackup> {
  if (encryptedBytes.byteLength < 29 || salt.length === 0) {
    throw new CapsuleError(
      "CAPSULE_KEY_INVALID",
      "Legacy IndexedDB private-key backup is malformed",
    );
  }
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(recoveryPhrase),
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
    ["decrypt"],
  );
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: copyBytes(encryptedBytes, 0, 12) },
      wrappingKey,
      copyBytes(encryptedBytes, 12),
    );
  } catch {
    throw new CapsuleError(
      "DECRYPTION_FAILED",
      "Legacy IndexedDB private-key backup could not be opened",
    );
  }
  const bytes = new Uint8Array(plaintext);
  try {
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new CapsuleError(
        "CAPSULE_KEY_INVALID",
        "Legacy IndexedDB private-key backup JWK is malformed",
      );
    }
    const validated = await validatePrivateKey(value, keyVersion, true);
    return { ...validated, keyVersion };
  } finally {
    bytes.fill(0);
  }
}
