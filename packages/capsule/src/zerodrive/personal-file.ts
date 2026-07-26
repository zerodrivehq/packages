import { createCapsule, openCapsule } from "../capsule.js";
import { CapsuleError } from "../errors.js";
import { isCapsule } from "../format.js";
import {
  decryptPersonalFile,
  derivePersonalFileKey,
} from "../personal-file.js";
import type { JsonObject } from "../types.js";
import {
  createZeroDriveCapsuleMetadata,
  metadataFromCapsule,
} from "./binary.js";
import { ZERO_DRIVE_FORMATS } from "./formats.js";
import type { ZeroDriveOpenResult } from "./types.js";

const PERSONAL_FILE_KIND = "zerodrive.personal-file";

export async function deriveZeroDriveLegacyVaultKey(
  recoveryPhrase: string,
): Promise<CryptoKey> {
  return derivePersonalFileKey(recoveryPhrase);
}

export async function createZeroDrivePersonalFileCapsule(input: {
  content: Uint8Array;
  metadata: JsonObject;
  recoveryPhrase: string;
}): Promise<Uint8Array> {
  const created = await createCapsule({
    plaintext: input.content,
    metadata: createZeroDriveCapsuleMetadata(
      PERSONAL_FILE_KIND,
      input.content.byteLength,
      input.metadata,
    ),
    recoveryPhrase: input.recoveryPhrase,
  });
  return created.bytes;
}

export async function openZeroDrivePersonalFile(input: {
  encryptedBytes: Uint8Array;
  recoveryPhrase?: string;
  legacyAesKey?: CryptoKey;
}): Promise<ZeroDriveOpenResult> {
  if (isCapsule(input.encryptedBytes)) {
    const opened = await openCapsule({
      capsule: input.encryptedBytes,
      ...(input.recoveryPhrase === undefined
        ? {}
        : { recoveryPhrase: input.recoveryPhrase }),
    });
    return {
      content: opened.plaintext,
      metadata: metadataFromCapsule(opened.metadata),
      format: ZERO_DRIVE_FORMATS.CAPSULE_V1,
    };
  }

  let key = input.legacyAesKey;
  if (key === undefined && input.recoveryPhrase !== undefined) {
    key = await deriveZeroDriveLegacyVaultKey(input.recoveryPhrase);
  }
  if (key === undefined) {
    throw new CapsuleError(
      "CAPSULE_ACCESS_REQUIRED",
      "Legacy personal file requires a recovery phrase or AES key",
    );
  }
  return {
    content: await decryptPersonalFile(input.encryptedBytes, key),
    metadata: {},
    format: ZERO_DRIVE_FORMATS.LEGACY_PERSONAL_V1,
  };
}
