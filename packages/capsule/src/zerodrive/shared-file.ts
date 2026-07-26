import { createCapsule, openCapsule } from "../capsule.js";
import { CapsuleError } from "../errors.js";
import { isCapsule, parseCapsuleHeader } from "../format.js";
import {
  fingerprintPublicKey,
  assertPositiveKeyVersion,
} from "../keys.js";
import { openLegacySharedFile } from "../legacy-shared.js";
import type {
  CapsulePrivateKey,
  CapsuleRecipient,
  JsonObject,
} from "../types.js";
import {
  createZeroDriveCapsuleMetadata,
  metadataFromCapsule,
} from "./binary.js";
import { ZERO_DRIVE_FORMATS } from "./formats.js";
import type { ZeroDriveOpenResult } from "./types.js";

const SHARED_FILE_KIND = "zerodrive.shared-file";

export interface ZeroDriveSharedRecipient {
  publicKeyJwk: JsonObject;
  fingerprint?: string;
  keyVersion?: number;
}

export interface ZeroDriveSharedPrivateKey {
  privateKeyJwk: JsonObject;
  keyVersion?: number;
}

function asJsonWebKey(value: JsonObject): JsonWebKey {
  return value as unknown as JsonWebKey;
}

async function prepareRecipient(
  recipient: ZeroDriveSharedRecipient,
): Promise<CapsuleRecipient> {
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
}

export async function createZeroDriveSharedFileCapsule(input: {
  content: Uint8Array;
  metadata: JsonObject;
  recipients: ZeroDriveSharedRecipient[];
}): Promise<Uint8Array> {
  const recipients = await Promise.all(input.recipients.map(prepareRecipient));
  const created = await createCapsule({
    plaintext: input.content,
    metadata: createZeroDriveCapsuleMetadata(
      SHARED_FILE_KIND,
      input.content.byteLength,
      input.metadata,
    ),
    recipients,
  });
  return created.bytes;
}

async function prepareCapsulePrivateKeys(
  encryptedBytes: Uint8Array,
  candidates: ZeroDriveSharedPrivateKey[],
): Promise<CapsulePrivateKey[]> {
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

export async function openZeroDriveSharedFile(input: {
  encryptedBytes: Uint8Array;
  recipientPrivateKeys?: CryptoKey[];
  recipientPrivateKeyJwks?: ZeroDriveSharedPrivateKey[];
  legacy?: {
    encryptedFileKey: string;
    encryptedMetadata?: string | null;
  };
}): Promise<ZeroDriveOpenResult> {
  if (isCapsule(input.encryptedBytes)) {
    const privateKeys = await prepareCapsulePrivateKeys(
      input.encryptedBytes,
      input.recipientPrivateKeyJwks ?? [],
    );
    const opened = await openCapsule({
      capsule: input.encryptedBytes,
      privateKeys,
      recipientPrivateKeys: input.recipientPrivateKeys ?? [],
    });
    return {
      content: opened.plaintext,
      metadata: metadataFromCapsule(opened.metadata),
      format: ZERO_DRIVE_FORMATS.CAPSULE_V1,
    };
  }

  if (input.legacy === undefined) {
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Legacy shared file requires its wrapped file key",
    );
  }
  const privateKeyJwks = input.recipientPrivateKeyJwks ?? [];
  const privateKeys = input.recipientPrivateKeys ?? [];
  if (privateKeyJwks.length === 0 && privateKeys.length === 0) {
    throw new CapsuleError(
      "CAPSULE_NO_MATCHING_KEY",
      "No recipient private key was provided",
    );
  }

  for (const candidate of privateKeyJwks) {
    try {
      const opened = await openLegacySharedFile({
        encryptedFile: input.encryptedBytes,
        wrappedFileKey: input.legacy.encryptedFileKey,
        privateKeyJwk: asJsonWebKey(candidate.privateKeyJwk),
        ...(candidate.keyVersion === undefined
          ? {}
          : { keyVersion: candidate.keyVersion }),
        ...(typeof input.legacy.encryptedMetadata === "string"
          ? { encryptedMetadata: input.legacy.encryptedMetadata }
          : {}),
      });
      return {
        content: opened.plaintext,
        metadata: opened.metadata,
        format: ZERO_DRIVE_FORMATS.LEGACY_SHARED_ZDSE,
      };
    } catch (error) {
      if (!(error instanceof CapsuleError)) throw error;
    }
  }
  for (const privateKey of privateKeys) {
    try {
      const opened = await openLegacySharedFile({
        encryptedFile: input.encryptedBytes,
        wrappedFileKey: input.legacy.encryptedFileKey,
        privateKey,
        ...(typeof input.legacy.encryptedMetadata === "string"
          ? { encryptedMetadata: input.legacy.encryptedMetadata }
          : {}),
      });
      return {
        content: opened.plaintext,
        metadata: opened.metadata,
        format: ZERO_DRIVE_FORMATS.LEGACY_SHARED_ZDSE,
      };
    } catch (error) {
      if (!(error instanceof CapsuleError)) throw error;
    }
  }
  throw new CapsuleError(
    "LEGACY_SHARED_FILE_INVALID",
    "Legacy shared file could not be opened with the provided keys",
  );
}
