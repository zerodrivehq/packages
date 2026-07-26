import { createCapsule, openCapsule } from "../capsule.js";
import { CapsuleError } from "../errors.js";
import { isCapsule } from "../format.js";
import { openLegacySharedMetadata } from "../legacy-shared.js";
import type { JsonObject } from "../types.js";
import {
  createZeroDriveCapsuleMetadata,
  metadataFromCapsule,
} from "./binary.js";
import { ZERO_DRIVE_FORMATS } from "./formats.js";
import {
  asJsonWebKey,
  prepareZeroDriveCapsulePrivateKeys,
  prepareZeroDriveRecipients,
  type ZeroDriveSharedPrivateKey,
  type ZeroDriveSharedRecipient,
} from "./shared-access.js";
import type { ZeroDriveSharedMetadataResult } from "./types.js";

const SHARED_METADATA_KIND = "zerodrive.shared-metadata";

export async function createZeroDriveSharedMetadataCapsule(input: {
  metadata: JsonObject;
  recipients: ZeroDriveSharedRecipient[];
}): Promise<Uint8Array> {
  const recipients = await prepareZeroDriveRecipients(input.recipients);
  const created = await createCapsule({
    plaintext: new Uint8Array(0),
    metadata: createZeroDriveCapsuleMetadata(
      SHARED_METADATA_KIND,
      0,
      input.metadata,
    ),
    recipients,
  });
  return created.bytes;
}

export async function openZeroDriveSharedMetadataCapsule(input: {
  encryptedBytes: Uint8Array;
  recipientPrivateKeys?: CryptoKey[];
  recipientPrivateKeyJwks?: ZeroDriveSharedPrivateKey[];
  legacy?: {
    encryptedFileKey: string;
    encryptedMetadata: string;
  };
}): Promise<ZeroDriveSharedMetadataResult> {
  if (isCapsule(input.encryptedBytes)) {
    const privateKeys = await prepareZeroDriveCapsulePrivateKeys(
      input.encryptedBytes,
      input.recipientPrivateKeyJwks ?? [],
    );
    const opened = await openCapsule({
      capsule: input.encryptedBytes,
      privateKeys,
      recipientPrivateKeys: input.recipientPrivateKeys ?? [],
    });
    try {
      if (
        opened.plaintext.byteLength !== 0 ||
        opened.metadata.attributes?.kind !== SHARED_METADATA_KIND ||
        opened.metadata.attributes.version !== 1
      ) {
        throw new CapsuleError(
          "CAPSULE_METADATA_INVALID",
          "Capsule is not ZeroDrive shared metadata",
        );
      }
      return {
        metadata: metadataFromCapsule(opened.metadata),
        format: ZERO_DRIVE_FORMATS.CAPSULE_V1,
      };
    } finally {
      opened.plaintext.fill(0);
    }
  }

  if (input.legacy === undefined) {
    throw new CapsuleError(
      "LEGACY_SHARED_FILE_INVALID",
      "Legacy shared metadata requires its wrapped file key",
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
      const opened = await openLegacySharedMetadata({
        encryptedMetadata: input.legacy.encryptedMetadata,
        wrappedFileKey: input.legacy.encryptedFileKey,
        privateKeyJwk: asJsonWebKey(candidate.privateKeyJwk),
        ...(candidate.keyVersion === undefined
          ? {}
          : { keyVersion: candidate.keyVersion }),
      });
      return {
        metadata: opened.metadata,
        format: ZERO_DRIVE_FORMATS.LEGACY_SHARED_ZDSE,
      };
    } catch (error) {
      if (!(error instanceof CapsuleError)) throw error;
    }
  }
  for (const privateKey of privateKeys) {
    try {
      const opened = await openLegacySharedMetadata({
        encryptedMetadata: input.legacy.encryptedMetadata,
        wrappedFileKey: input.legacy.encryptedFileKey,
        privateKey,
      });
      return {
        metadata: opened.metadata,
        format: ZERO_DRIVE_FORMATS.LEGACY_SHARED_ZDSE,
      };
    } catch (error) {
      if (!(error instanceof CapsuleError)) throw error;
    }
  }
  throw new CapsuleError(
    "LEGACY_SHARED_FILE_INVALID",
    "Legacy shared metadata could not be opened with the provided keys",
  );
}
