import { decryptPersonalFile } from "../personal-file.js";
import type { JsonValue } from "../types.js";
import { decodeJson } from "./binary.js";

export async function openLegacyZeroDriveMetadata(
  encryptedBytes: Uint8Array,
  key: CryptoKey,
): Promise<JsonValue> {
  const plaintext = await decryptPersonalFile(encryptedBytes, key);
  try {
    return decodeJson(plaintext);
  } finally {
    plaintext.fill(0);
  }
}
