import { createCapsule, openCapsule } from "../capsule.js";
import { CapsuleError } from "../errors.js";
import { isCapsule } from "../format.js";
import type { JsonValue } from "../types.js";
import {
  createZeroDriveCapsuleMetadata,
  decodeJson,
  encodeJson,
} from "./binary.js";
import { ZERO_DRIVE_FORMATS } from "./formats.js";
import { openLegacyZeroDriveMetadata } from "./legacy-metadata.js";
import { deriveZeroDriveLegacyVaultKey } from "./personal-file.js";
import type { ZeroDriveVaultIndexResult } from "./types.js";

const VAULT_INDEX_KIND = "zerodrive.vault-index";

export async function createZeroDriveVaultIndexCapsule(input: {
  index: JsonValue;
  recoveryPhrase: string;
}): Promise<Uint8Array> {
  const plaintext = encodeJson(input.index);
  try {
    const created = await createCapsule({
      plaintext,
      metadata: createZeroDriveCapsuleMetadata(
        VAULT_INDEX_KIND,
        plaintext.byteLength,
      ),
      recoveryPhrase: input.recoveryPhrase,
    });
    return created.bytes;
  } finally {
    plaintext.fill(0);
  }
}

export async function openZeroDriveVaultIndex(input: {
  encryptedBytes: Uint8Array;
  recoveryPhrase?: string;
  legacyAesKey?: CryptoKey;
}): Promise<ZeroDriveVaultIndexResult> {
  if (isCapsule(input.encryptedBytes)) {
    const opened = await openCapsule({
      capsule: input.encryptedBytes,
      ...(input.recoveryPhrase === undefined
        ? {}
        : { recoveryPhrase: input.recoveryPhrase }),
    });
    try {
      if (
        opened.metadata.attributes?.kind !== VAULT_INDEX_KIND ||
        opened.metadata.attributes.version !== 1
      ) {
        throw new CapsuleError(
          "CAPSULE_METADATA_INVALID",
          "Capsule is not a ZeroDrive vault index",
        );
      }
      return {
        index: decodeJson(opened.plaintext),
        format: ZERO_DRIVE_FORMATS.CAPSULE_V1,
      };
    } finally {
      opened.plaintext.fill(0);
    }
  }

  let key = input.legacyAesKey;
  if (key === undefined && input.recoveryPhrase !== undefined) {
    key = await deriveZeroDriveLegacyVaultKey(input.recoveryPhrase);
  }
  if (key === undefined) {
    throw new CapsuleError(
      "CAPSULE_ACCESS_REQUIRED",
      "Legacy vault index requires a recovery phrase or AES key",
    );
  }
  return {
    index: await openLegacyZeroDriveMetadata(input.encryptedBytes, key),
    format: ZERO_DRIVE_FORMATS.LEGACY_METADATA_V1,
  };
}
