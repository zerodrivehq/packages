import { createCapsule, openCapsule } from "./capsule.js";
import { CapsuleError } from "./errors.js";
import {
  fingerprintPublicKey,
  importRecipientPrivateKey,
  assertPositiveKeyVersion,
} from "./keys.js";
import { decryptPersonalFileWithRecoveryPhrase } from "./personal-file.js";
import { stableStringify } from "./encoding.js";
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

export async function createPrivateKeyBackupCapsule(
  input: CreatePrivateKeyBackupInput,
): Promise<CreatedCapsule> {
  const { privateKeyJwk, fingerprint } = await validatePrivateKey(
    input.privateKeyJwk,
    input.keyVersion,
  );
  const plaintext = new TextEncoder().encode(stableStringify(privateKeyJwk));
  try {
    return await createCapsule({
      plaintext,
      recoveryPhrase: input.recoveryPhrase,
      metadata: {
        name: "zerodrive-rsa-private-key.json",
        mimeType: "application/jwk+json",
        size: plaintext.byteLength,
        attributes: {
          kind: "private-key-backup",
          keyVersion: input.keyVersion,
          fingerprint,
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
    const validated = await validatePrivateKey(value, attributes.keyVersion);
    if (validated.fingerprint !== attributes.fingerprint) {
      throw new CapsuleError(
        "CAPSULE_KEY_INVALID",
        "Private-key backup fingerprint does not match",
      );
    }
    return {
      privateKeyJwk: validated.privateKeyJwk,
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
