import { CapsuleError } from "./errors.js";
import { base64UrlToBytes, bytesToHex } from "./encoding.js";
import type { RecipientKeyPair } from "./types.js";

function assertRsaPublicParts(jwk: JsonWebKey): asserts jwk is JsonWebKey & {
  kty: "RSA";
  n: string;
  e: string;
} {
  if (jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") {
    throw new CapsuleError("CAPSULE_KEY_INVALID", "RSA public key is invalid");
  }
}

export function assertPositiveKeyVersion(keyVersion: number): void {
  if (!Number.isInteger(keyVersion) || keyVersion <= 0 || keyVersion > 0xffff_ffff) {
    throw new CapsuleError("CAPSULE_KEY_INVALID", "Key version is invalid");
  }
}

export async function fingerprintPublicKey(jwk: JsonWebKey): Promise<string> {
  assertRsaPublicParts(jwk);
  const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function importRecipientPublicKey(
  jwk: JsonWebKey,
): Promise<CryptoKey> {
  assertRsaPublicParts(jwk);
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"],
    );
  } catch {
    throw new CapsuleError("CAPSULE_KEY_INVALID", "RSA public key is invalid");
  }
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
  if (algorithm.modulusLength < 2048 || algorithm.modulusLength > 4096) {
    throw new CapsuleError(
      "CAPSULE_KEY_INVALID",
      "RSA key size is unsupported",
    );
  }
  return key;
}

export async function importRecipientPrivateKey(
  jwk: JsonWebKey,
  hash: "SHA-1" | "SHA-256" = "SHA-256",
): Promise<CryptoKey> {
  assertRsaPublicParts(jwk);
  if (typeof jwk.d !== "string") {
    throw new CapsuleError("CAPSULE_KEY_INVALID", "RSA private key is invalid");
  }
  try {
    return await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSA-OAEP", hash },
      false,
      ["decrypt"],
    );
  } catch {
    throw new CapsuleError("CAPSULE_KEY_INVALID", "RSA private key is invalid");
  }
}

export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function generateRecipientKeyPair(): Promise<RecipientKeyPair> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"],
  );
  return {
    publicKeyJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
    privateKeyJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
}

export function rsaModulusBytes(jwk: JsonWebKey): number {
  assertRsaPublicParts(jwk);
  return base64UrlToBytes(jwk.n).byteLength;
}
