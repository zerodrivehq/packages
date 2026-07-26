import { CapsuleError } from "../errors.js";
import { isCapsule, parseCapsuleHeader } from "../format.js";
import {
  assertPositiveKeyVersion,
  fingerprintPublicKey,
} from "../keys.js";
import type {
  CapsulePrivateKey,
  CapsuleRecipient,
  JsonObject,
} from "../types.js";

export interface ZeroDriveSharedRecipient {
  publicKeyJwk: JsonObject;
  fingerprint?: string;
  keyVersion?: number;
}

export interface ZeroDriveSharedPrivateKey {
  privateKeyJwk: JsonObject;
  keyVersion?: number;
}

export function asJsonWebKey(value: JsonObject): JsonWebKey {
  return value as unknown as JsonWebKey;
}

export async function prepareZeroDriveRecipients(
  recipients: ZeroDriveSharedRecipient[],
): Promise<CapsuleRecipient[]> {
  return Promise.all(
    recipients.map(async (recipient) => {
      const keyVersion = recipient.keyVersion ?? 1;
      assertPositiveKeyVersion(keyVersion);
      const publicKeyJwk = asJsonWebKey(recipient.publicKeyJwk);
      const fingerprint = await fingerprintPublicKey(publicKeyJwk);
      if (
        recipient.fingerprint !== undefined &&
        recipient.fingerprint !== fingerprint
      ) {
        throw new CapsuleError(
          "CAPSULE_KEY_INVALID",
          "Recipient public-key fingerprint does not match",
        );
      }
      return { publicKeyJwk, keyVersion };
    }),
  );
}

export async function prepareZeroDriveCapsulePrivateKeys(
  encryptedBytes: Uint8Array,
  candidates: ZeroDriveSharedPrivateKey[],
): Promise<CapsulePrivateKey[]> {
  if (!isCapsule(encryptedBytes)) return [];
  const header = parseCapsuleHeader(encryptedBytes);
  const prepared: CapsulePrivateKey[] = [];
  for (const candidate of candidates) {
    const privateKeyJwk = asJsonWebKey(candidate.privateKeyJwk);
    if (candidate.keyVersion !== undefined) {
      assertPositiveKeyVersion(candidate.keyVersion);
      prepared.push({ privateKeyJwk, keyVersion: candidate.keyVersion });
      continue;
    }
    const fingerprint = await fingerprintPublicKey(privateKeyJwk);
    for (const recipient of header.recipients) {
      if (recipient.fingerprint === fingerprint) {
        prepared.push({
          privateKeyJwk,
          keyVersion: recipient.keyVersion,
        });
      }
    }
  }
  return prepared;
}
