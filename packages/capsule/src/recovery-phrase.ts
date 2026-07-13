import {
  generateMnemonic,
  mnemonicToSeedWebcrypto,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english.js";

import { OWNER_KEY_INFO } from "./constants.js";
import { CapsuleError } from "./errors.js";
import { normalizeRecoveryPhrase } from "./personal-file.js";

export function generateRecoveryPhrase(): string {
  return generateMnemonic(englishWordlist, 128);
}

export function validateRecoveryPhrase(recoveryPhrase: string): boolean {
  return validateMnemonic(normalizeRecoveryPhrase(recoveryPhrase), englishWordlist);
}

export async function deriveOwnerWrappingKey(
  recoveryPhrase: string,
  salt: Uint8Array<ArrayBuffer>,
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

  try {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      seedBytes,
      "HKDF",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: OWNER_KEY_INFO,
      },
      keyMaterial,
      { name: "AES-KW", length: 256 },
      false,
      ["wrapKey", "unwrapKey"],
    );
  } finally {
    seed.fill(0);
    seedBytes.fill(0);
  }
}
