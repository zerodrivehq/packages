import { createCapsule, openCapsule } from "../capsule.js";
import { CapsuleError } from "../errors.js";
import { isCapsule } from "../format.js";
import {
  fingerprintPublicKey,
  assertPositiveKeyVersion,
} from "../keys.js";
import { openLegacySharedFile } from "../legacy-shared.js";
import type { CapsuleRecipient, JsonObject } from "../types.js";
import {
  createZeroDriveCapsuleMetadata,
  metadataFromCapsule,
} from "./binary.js";
import { ZERO_DRIVE_FORMATS } from "./formats.js";
import type { ZeroDriveOpenResult } from "./types.js";

const SHARED_FILE_KIND = "zerodrive.shared-file";

export interface ZeroDriveSharedRecipient {
  publicKey: CryptoKey;
  fingerprint?: string;
  keyVersion?: number;
}

async function prepareRecipient(
  recipient: ZeroDriveSharedRecipient,
): Promise<CapsuleRecipient> {
  const keyVersion = recipient.keyVersion ?? 1;
  assertPositiveKeyVersion(keyVersion);
  let publicKeyJwk: JsonWebKey;
  try {
    publicKeyJwk = await crypto.subtle.exportKey("jwk", recipient.publicKey);
  } catch {
    throw new CapsuleError(
      "CAPSULE_KEY_INVALID",
      "Recipient public key must be extractable",
    );
  }
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

export async function openZeroDriveSharedFile(input: {
  encryptedBytes: Uint8Array;
  recipientPrivateKeys: CryptoKey[];
  legacy?: {
    encryptedFileKey: string;
    encryptedMetadata?: string | null;
  };
}): Promise<ZeroDriveOpenResult> {
  if (isCapsule(input.encryptedBytes)) {
    const opened = await openCapsule({
      capsule: input.encryptedBytes,
      recipientPrivateKeys: input.recipientPrivateKeys,
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
  if (input.recipientPrivateKeys.length === 0) {
    throw new CapsuleError(
      "CAPSULE_NO_MATCHING_KEY",
      "No recipient private key was provided",
    );
  }

  for (const privateKey of input.recipientPrivateKeys) {
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
