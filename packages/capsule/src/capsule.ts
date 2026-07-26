import {
  CAPSULE_GCM_TAG_BYTES,
  CAPSULE_IV_BYTES,
  CAPSULE_MAX_METADATA_BYTES,
  CAPSULE_MAX_RECIPIENTS,
  CAPSULE_RECOVERY_SALT_BYTES,
} from "./constants.js";
import { bytesEqual } from "./encoding.js";
import { CapsuleError } from "./errors.js";
import {
  parseCapsuleBytes,
  parseCapsuleHeader,
  serializeCapsuleHeader,
  type ParsedCapsule,
  type RecipientEnvelope,
} from "./format.js";
import {
  assertPositiveKeyVersion,
  fingerprintPublicKey,
  importRecipientPrivateKey,
  importRecipientPublicKey,
} from "./keys.js";
import {
  parseCapsuleMetadata,
  serializeCapsuleMetadata,
} from "./metadata.js";
import { deriveOwnerWrappingKey } from "./recovery-phrase.js";
import type {
  CapsuleAccess,
  CapsulePrivateKey,
  CapsuleRecipient,
  CreateCapsuleInput,
  CreatedCapsule,
  OpenCapsuleInput,
  OpenedCapsule,
} from "./types.js";

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function zeroBytes(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(length);
}

async function prepareRecipients(
  recipients: CapsuleRecipient[],
  rawDataKey: Uint8Array<ArrayBuffer>,
): Promise<RecipientEnvelope[]> {
  const prepared = await Promise.all(
    recipients.map(async (recipient) => {
      assertPositiveKeyVersion(recipient.keyVersion);
      const [key, fingerprint] = await Promise.all([
        importRecipientPublicKey(recipient.publicKeyJwk),
        fingerprintPublicKey(recipient.publicKeyJwk),
      ]);
      const wrappedKey = new Uint8Array(
        await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, rawDataKey),
      );
      return { keyVersion: recipient.keyVersion, fingerprint, wrappedKey };
    }),
  );
  prepared.sort(
    (left, right) =>
      left.fingerprint.localeCompare(right.fingerprint) ||
      left.keyVersion - right.keyVersion,
  );
  for (let index = 1; index < prepared.length; index += 1) {
    const previous = prepared[index - 1]!;
    const current = prepared[index]!;
    if (
      previous.keyVersion === current.keyVersion &&
      previous.fingerprint === current.fingerprint
    ) {
      for (const envelope of prepared) envelope.wrappedKey.fill(0);
      throw new CapsuleError(
        "CAPSULE_RECIPIENT_INVALID",
        "Capsule has a duplicate recipient",
      );
    }
  }
  return prepared;
}

async function wrapForOwner(
  rawDataKey: Uint8Array<ArrayBuffer>,
  recoveryPhrase: string,
  recoverySalt: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  const [wrappingKey, dataKey] = await Promise.all([
    deriveOwnerWrappingKey(recoveryPhrase, recoverySalt),
    crypto.subtle.importKey(
      "raw",
      rawDataKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    ),
  ]);
  return new Uint8Array(
    await crypto.subtle.wrapKey("raw", dataKey, wrappingKey, "AES-KW"),
  );
}

export async function createCapsule(
  input: CreateCapsuleInput,
): Promise<CreatedCapsule> {
  const recipients = input.recipients ?? [];
  const hasRecovery = input.recoveryPhrase !== undefined;
  if (!hasRecovery && recipients.length === 0) {
    throw new CapsuleError(
      "CAPSULE_ACCESS_REQUIRED",
      "Capsule requires owner recovery or a recipient",
    );
  }
  if (recipients.length > CAPSULE_MAX_RECIPIENTS) {
    throw new CapsuleError(
      "CAPSULE_RECIPIENT_INVALID",
      "Capsule has too many recipients",
    );
  }

  const plaintext = Uint8Array.from(input.plaintext);
  const metadataBytes = serializeCapsuleMetadata(input.metadata, plaintext.byteLength);
  if (metadataBytes.byteLength > CAPSULE_MAX_METADATA_BYTES) {
    throw new CapsuleError(
      "CAPSULE_METADATA_INVALID",
      "Capsule metadata is too large",
    );
  }

  const rawDataKey = randomBytes(32);
  const recoverySalt = hasRecovery
    ? randomBytes(CAPSULE_RECOVERY_SALT_BYTES)
    : zeroBytes(CAPSULE_RECOVERY_SALT_BYTES);
  const metadataIv = randomBytes(CAPSULE_IV_BYTES);
  let contentIv = randomBytes(CAPSULE_IV_BYTES);
  while (bytesEqual(metadataIv, contentIv)) {
    contentIv.fill(0);
    contentIv = randomBytes(CAPSULE_IV_BYTES);
  }

  let ownerWrappedKey: Uint8Array | undefined;
  let recipientEnvelopes: RecipientEnvelope[] = [];
  try {
    const ownerPromise = hasRecovery
      ? wrapForOwner(rawDataKey, input.recoveryPhrase!, recoverySalt)
      : Promise.resolve(undefined);
    [ownerWrappedKey, recipientEnvelopes] = await Promise.all([
      ownerPromise,
      prepareRecipients(recipients, rawDataKey),
    ]);

    const metadataCiphertextLength =
      metadataBytes.byteLength + CAPSULE_GCM_TAG_BYTES;
    const contentCiphertextLength = plaintext.byteLength + CAPSULE_GCM_TAG_BYTES;
    if (
      metadataCiphertextLength > 0xffff_ffff ||
      contentCiphertextLength > 0xffff_ffff
    ) {
      throw new CapsuleError(
        "CAPSULE_MALFORMED",
        "Capsule content is too large for format version 1",
      );
    }

    const headerBytes = serializeCapsuleHeader({
      recoverySalt,
      metadataIv,
      contentIv,
      ...(ownerWrappedKey === undefined ? {} : { ownerWrappedKey }),
      recipientEnvelopes,
      metadataCiphertextLength,
      contentCiphertextLength,
    });
    const dataKey = await crypto.subtle.importKey(
      "raw",
      rawDataKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    const [metadataCiphertext, contentCiphertext] = await Promise.all([
      crypto.subtle.encrypt(
        { name: "AES-GCM", iv: metadataIv, additionalData: headerBytes },
        dataKey,
        metadataBytes,
      ),
      crypto.subtle.encrypt(
        { name: "AES-GCM", iv: contentIv, additionalData: headerBytes },
        dataKey,
        plaintext,
      ),
    ]);
    const bytes = new Uint8Array(
      headerBytes.byteLength +
        metadataCiphertext.byteLength +
        contentCiphertext.byteLength,
    );
    bytes.set(headerBytes, 0);
    bytes.set(new Uint8Array(metadataCiphertext), headerBytes.byteLength);
    bytes.set(
      new Uint8Array(contentCiphertext),
      headerBytes.byteLength + metadataCiphertext.byteLength,
    );
    return { bytes, header: parseCapsuleHeader(bytes) };
  } finally {
    plaintext.fill(0);
    metadataBytes.fill(0);
    rawDataKey.fill(0);
    recoverySalt.fill(0);
    metadataIv.fill(0);
    contentIv.fill(0);
    ownerWrappedKey?.fill(0);
    for (const recipient of recipientEnvelopes) recipient.wrappedKey.fill(0);
  }
}

async function unwrapForOwner(
  parsed: ParsedCapsule,
  recoveryPhrase: string,
): Promise<CryptoKey> {
  const wrappingKey = await deriveOwnerWrappingKey(
    recoveryPhrase,
    parsed.recoverySalt,
  );
  try {
    return await crypto.subtle.unwrapKey(
      "raw",
      parsed.ownerWrappedKey!,
      wrappingKey,
      "AES-KW",
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
  } catch {
    throw new CapsuleError(
      "CAPSULE_KEY_UNWRAP_FAILED",
      "Capsule data key could not be unwrapped",
    );
  }
}

async function unwrapForRecipients(
  parsed: ParsedCapsule,
  privateKeys: CapsulePrivateKey[],
): Promise<{ key: CryptoKey; access: CapsuleAccess } | undefined> {
  let matched = false;
  for (const candidate of privateKeys) {
    assertPositiveKeyVersion(candidate.keyVersion);
    const fingerprint = await fingerprintPublicKey(candidate.privateKeyJwk);
    const envelope = parsed.recipientEnvelopes.find(
      (recipient) =>
        recipient.keyVersion === candidate.keyVersion &&
        recipient.fingerprint === fingerprint,
    );
    if (envelope === undefined) continue;
    matched = true;
    let rawKey: Uint8Array | undefined;
    try {
      const privateKey = await importRecipientPrivateKey(candidate.privateKeyJwk);
      rawKey = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "RSA-OAEP" },
          privateKey,
          envelope.wrappedKey,
        ),
      );
      if (rawKey.byteLength !== 32) throw new Error("invalid key length");
      const keyBytes = Uint8Array.from(rawKey);
      try {
        const key = await crypto.subtle.importKey(
          "raw",
          keyBytes,
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"],
        );
        return {
          key,
          access: {
            kind: "recipient",
            keyVersion: candidate.keyVersion,
            fingerprint,
          },
        };
      } finally {
        keyBytes.fill(0);
      }
    } catch {
      // Try another matching versioned key before reporting unwrap failure.
    } finally {
      rawKey?.fill(0);
    }
  }
  if (matched) {
    throw new CapsuleError(
      "CAPSULE_KEY_UNWRAP_FAILED",
      "Capsule data key could not be unwrapped",
    );
  }
  return undefined;
}

async function unwrapForRecipientCryptoKeys(
  parsed: ParsedCapsule,
  privateKeys: CryptoKey[],
): Promise<{ key: CryptoKey; access: CapsuleAccess } | undefined> {
  let attempted = false;
  for (const privateKey of privateKeys) {
    for (const envelope of parsed.recipientEnvelopes) {
      attempted = true;
      let rawKey: Uint8Array | undefined;
      try {
        rawKey = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            privateKey,
            envelope.wrappedKey,
          ),
        );
        if (rawKey.byteLength !== 32) continue;
        const keyBytes = Uint8Array.from(rawKey);
        try {
          return {
            key: await crypto.subtle.importKey(
              "raw",
              keyBytes,
              { name: "AES-GCM", length: 256 },
              false,
              ["decrypt"],
            ),
            access: {
              kind: "recipient",
              keyVersion: envelope.keyVersion,
              fingerprint: envelope.fingerprint,
            },
          };
        } finally {
          keyBytes.fill(0);
        }
      } catch {
        // A CryptoKey has no exportable fingerprint, so try every envelope.
      } finally {
        rawKey?.fill(0);
      }
    }
  }
  if (attempted) {
    throw new CapsuleError(
      "CAPSULE_KEY_UNWRAP_FAILED",
      "Capsule data key could not be unwrapped",
    );
  }
  return undefined;
}

async function resolveDataKey(
  parsed: ParsedCapsule,
  input: OpenCapsuleInput,
): Promise<{ key: CryptoKey; access: CapsuleAccess }> {
  let ownerFailed = false;
  if (parsed.header.hasRecovery && input.recoveryPhrase !== undefined) {
    try {
      return {
        key: await unwrapForOwner(parsed, input.recoveryPhrase),
        access: { kind: "recovery-phrase" },
      };
    } catch (error) {
      if (
        error instanceof CapsuleError &&
        error.code === "INVALID_RECOVERY_PHRASE"
      ) {
        throw error;
      }
      ownerFailed = true;
    }
  }
  const recipient = await unwrapForRecipients(parsed, input.privateKeys ?? []);
  if (recipient !== undefined) return recipient;
  const cryptoKeyRecipient = await unwrapForRecipientCryptoKeys(
    parsed,
    input.recipientPrivateKeys ?? [],
  );
  if (cryptoKeyRecipient !== undefined) return cryptoKeyRecipient;
  if (ownerFailed) {
    throw new CapsuleError(
      "CAPSULE_KEY_UNWRAP_FAILED",
      "Capsule data key could not be unwrapped",
    );
  }
  throw new CapsuleError(
    "CAPSULE_NO_MATCHING_KEY",
    "No matching capsule access key was provided",
  );
}

export async function openCapsule(
  input: OpenCapsuleInput,
): Promise<OpenedCapsule> {
  const parsed = parseCapsuleBytes(input.capsule);
  const { key, access } = await resolveDataKey(parsed, input);
  let metadataPlaintext: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  try {
    try {
      const [metadata, content] = await Promise.all([
        crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: parsed.metadataIv,
            additionalData: parsed.headerBytes,
          },
          key,
          parsed.metadataCiphertext,
        ),
        crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: parsed.contentIv,
            additionalData: parsed.headerBytes,
          },
          key,
          parsed.contentCiphertext,
        ),
      ]);
      metadataPlaintext = new Uint8Array(metadata);
      plaintext = new Uint8Array(content);
    } catch {
      throw new CapsuleError(
        "CAPSULE_AUTHENTICATION_FAILED",
        "Capsule could not be authenticated or decrypted",
      );
    }
    const metadata = parseCapsuleMetadata(
      metadataPlaintext,
      plaintext.byteLength,
    );
    const result = { plaintext, metadata, access };
    plaintext = undefined;
    return result;
  } finally {
    metadataPlaintext?.fill(0);
    plaintext?.fill(0);
    parsed.headerBytes.fill(0);
    parsed.recoverySalt.fill(0);
    parsed.metadataIv.fill(0);
    parsed.contentIv.fill(0);
    parsed.ownerWrappedKey?.fill(0);
    parsed.metadataCiphertext.fill(0);
    parsed.contentCiphertext.fill(0);
    for (const recipient of parsed.recipientEnvelopes) {
      recipient.wrappedKey.fill(0);
    }
  }
}
