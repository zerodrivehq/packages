import { mnemonicToSeedWebcrypto, validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english.js";

import { copyBytes } from "./encoding.js";
import { CapsuleError } from "./errors.js";

export const PERSONAL_FILE_IV_BYTES = 12;
export const PERSONAL_FILE_TAG_BYTES = 16;
export const PERSONAL_FILE_MIN_BYTES =
  PERSONAL_FILE_IV_BYTES + PERSONAL_FILE_TAG_BYTES;

export function normalizeRecoveryPhrase(recoveryPhrase: string): string {
  return recoveryPhrase.trim().split(/\s+/u).join(" ");
}

export async function derivePersonalFileKey(
  recoveryPhrase: string,
): Promise<CryptoKey> {
  const normalized = normalizeRecoveryPhrase(recoveryPhrase);
  if (!validateMnemonic(normalized, englishWordlist)) {
    throw new CapsuleError(
      "INVALID_RECOVERY_PHRASE",
      "Recovery phrase is invalid",
    );
  }

  const seed = await mnemonicToSeedWebcrypto(normalized);
  const seedBytes = Uint8Array.from(seed);
  let keyBytes: Uint8Array<ArrayBuffer> | undefined;

  try {
    keyBytes = new Uint8Array(
      await globalThis.crypto.subtle.digest("SHA-256", seedBytes),
    );
    return await globalThis.crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
  } finally {
    seed.fill(0);
    seedBytes.fill(0);
    keyBytes?.fill(0);
  }
}

export async function decryptPersonalFile(
  encryptedBytes: Uint8Array,
  key: CryptoKey,
): Promise<Uint8Array> {
  if (encryptedBytes.byteLength < PERSONAL_FILE_MIN_BYTES) {
    throw new CapsuleError(
      "INVALID_ENCRYPTED_FILE",
      "Encrypted file is too small to be a ZeroDrive personal file",
    );
  }

  const iv = copyBytes(encryptedBytes, 0, PERSONAL_FILE_IV_BYTES);
  const ciphertext = copyBytes(encryptedBytes, PERSONAL_FILE_IV_BYTES);

  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new CapsuleError(
      "DECRYPTION_FAILED",
      "Personal file could not be authenticated or decrypted",
    );
  } finally {
    iv.fill(0);
    ciphertext.fill(0);
  }
}

export async function decryptPersonalFileWithRecoveryPhrase(
  encryptedBytes: Uint8Array,
  recoveryPhrase: string,
): Promise<Uint8Array> {
  const key = await derivePersonalFileKey(recoveryPhrase);
  return decryptPersonalFile(encryptedBytes, key);
}
