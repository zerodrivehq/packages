import { CapsuleError } from "../errors.js";
import { isCapsule } from "../format.js";
import { fingerprintPublicKey } from "../keys.js";
import {
  createPrivateKeyBackupCapsule,
  openLegacyPbkdf2PrivateKeyBackup,
  openLegacyPrivateKeyBackup,
  openPrivateKeyBackupCapsule,
} from "../private-key-backup.js";
import type { JsonObject } from "../types.js";
import { jsonWebKeyToJsonObject } from "./binary.js";
import { ZERO_DRIVE_FORMATS } from "./formats.js";
import type { ZeroDriveEncryptedFormat } from "./formats.js";

function asJsonWebKey(value: JsonObject): JsonWebKey {
  return value as unknown as JsonWebKey;
}

export async function createZeroDriveSharingKeyBackup(input: {
  privateKeyJwk: JsonObject;
  publicKeyJwk?: JsonObject;
  recoveryPhrase: string;
  keyVersion?: number;
  fingerprint?: string;
}): Promise<Uint8Array> {
  const privateKeyJwk = asJsonWebKey(input.privateKeyJwk);
  const calculatedFingerprint = await fingerprintPublicKey(privateKeyJwk);
  if (
    input.fingerprint !== undefined &&
    input.fingerprint !== calculatedFingerprint
  ) {
    throw new CapsuleError(
      "CAPSULE_KEY_INVALID",
      "Sharing-key backup fingerprint does not match",
    );
  }
  const publicKeyJwk =
    input.publicKeyJwk === undefined
      ? undefined
      : asJsonWebKey(input.publicKeyJwk);
  if (
    publicKeyJwk !== undefined &&
    (await fingerprintPublicKey(publicKeyJwk)) !== calculatedFingerprint
  ) {
    throw new CapsuleError(
      "CAPSULE_KEY_INVALID",
      "Sharing-key backup public key does not match",
    );
  }

  const created = await createPrivateKeyBackupCapsule({
    privateKeyJwk,
    ...(publicKeyJwk === undefined ? {} : { publicKeyJwk }),
    recoveryPhrase: input.recoveryPhrase,
    keyVersion: input.keyVersion ?? 1,
    fingerprint: calculatedFingerprint,
  });
  return created.bytes;
}

export async function openZeroDriveSharingKeyBackup(input: {
  encryptedBytes: Uint8Array;
  recoveryPhrase: string;
  legacyPbkdf2Salt?: string;
  legacyKeyVersion?: number;
}): Promise<{
  privateKeyJwk: JsonObject;
  publicKeyJwk?: JsonObject;
  keyVersion?: number;
  fingerprint?: string;
  format: ZeroDriveEncryptedFormat;
}> {
  let opened;
  if (isCapsule(input.encryptedBytes)) {
    opened = await openPrivateKeyBackupCapsule({
      capsule: input.encryptedBytes,
      recoveryPhrase: input.recoveryPhrase,
    });
  } else {
    try {
      opened = await openLegacyPrivateKeyBackup(
        input.encryptedBytes,
        input.recoveryPhrase,
        input.legacyKeyVersion,
      );
    } catch (error) {
      if (input.legacyPbkdf2Salt === undefined) throw error;
      opened = await openLegacyPbkdf2PrivateKeyBackup(
        input.encryptedBytes,
        input.recoveryPhrase,
        input.legacyPbkdf2Salt,
        input.legacyKeyVersion,
      );
    }
  }
  const privateKeyJwk = jsonWebKeyToJsonObject(
    opened.privateKeyJwk,
    "Sharing-key backup private JWK is malformed",
  );
  const publicKeyJwk =
    opened.publicKeyJwk === undefined
      ? undefined
      : jsonWebKeyToJsonObject(
          opened.publicKeyJwk,
          "Sharing-key backup public JWK is malformed",
        );
  return {
    privateKeyJwk,
    ...(publicKeyJwk === undefined ? {} : { publicKeyJwk }),
    keyVersion: opened.keyVersion,
    fingerprint: opened.fingerprint,
    format: isCapsule(input.encryptedBytes)
      ? ZERO_DRIVE_FORMATS.CAPSULE_V1
      : ZERO_DRIVE_FORMATS.LEGACY_PRIVATE_KEY_BACKUP_V1,
  };
}
