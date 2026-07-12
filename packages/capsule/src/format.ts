import {
  CAPSULE_FINGERPRINT_BYTES,
  CAPSULE_FIXED_HEADER_BYTES,
  CAPSULE_FLAG_OWNER_RECOVERY,
  CAPSULE_GCM_TAG_BYTES,
  CAPSULE_IV_BYTES,
  CAPSULE_KNOWN_FLAGS,
  CAPSULE_MAGIC,
  CAPSULE_MAX_HEADER_BYTES,
  CAPSULE_MAX_METADATA_BYTES,
  CAPSULE_MAX_RECIPIENTS,
  CAPSULE_OWNER_WRAP_BYTES,
  CAPSULE_RECIPIENT_ALGORITHM_RSA_OAEP_256,
  CAPSULE_RECIPIENT_FIXED_BYTES,
  CAPSULE_RECOVERY_SALT_BYTES,
  CAPSULE_SUITE,
  CAPSULE_VERSION,
} from "./constants.js";
import { bytesEqual, bytesToHex, hexToBytes } from "./encoding.js";
import { CapsuleError } from "./errors.js";
import type { CapsuleHeader } from "./types.js";

export interface RecipientEnvelope {
  keyVersion: number;
  fingerprint: string;
  wrappedKey: Uint8Array<ArrayBuffer>;
}

export interface ParsedCapsule {
  header: CapsuleHeader;
  headerBytes: Uint8Array<ArrayBuffer>;
  recoverySalt: Uint8Array<ArrayBuffer>;
  metadataIv: Uint8Array<ArrayBuffer>;
  contentIv: Uint8Array<ArrayBuffer>;
  ownerWrappedKey?: Uint8Array<ArrayBuffer>;
  recipientEnvelopes: RecipientEnvelope[];
  metadataCiphertext: Uint8Array<ArrayBuffer>;
  contentCiphertext: Uint8Array<ArrayBuffer>;
}

interface SerializeHeaderInput {
  recoverySalt: Uint8Array;
  metadataIv: Uint8Array;
  contentIv: Uint8Array;
  ownerWrappedKey?: Uint8Array;
  recipientEnvelopes: RecipientEnvelope[];
  metadataCiphertextLength: number;
  contentCiphertextLength: number;
}

function malformed(message: string): never {
  throw new CapsuleError("CAPSULE_MALFORMED", message);
}

function copyBytes(
  bytes: Uint8Array,
  start = 0,
  end = bytes.byteLength,
): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(end - start);
  copy.set(bytes.subarray(start, end));
  return copy;
}

function hasMagic(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= CAPSULE_MAGIC.byteLength &&
    CAPSULE_MAGIC.every((value, index) => bytes[index] === value)
  );
}

export function isCapsule(bytes: Uint8Array): boolean {
  return hasMagic(bytes);
}

function assertWrappedKeyLength(length: number): void {
  if (length !== 256 && length !== 384 && length !== 512) {
    malformed("Recipient wrapped-key length is unsupported");
  }
}

function parseCapsule(bytes: Uint8Array): ParsedCapsule {
  if (!hasMagic(bytes) || bytes.byteLength < CAPSULE_FIXED_HEADER_BYTES) {
    malformed("Capsule header is truncated or has invalid magic bytes");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(4);
  if (version !== CAPSULE_VERSION) {
    throw new CapsuleError(
      "CAPSULE_UNSUPPORTED_VERSION",
      "Capsule version is unsupported",
    );
  }
  const suite = view.getUint8(5);
  if (suite !== CAPSULE_SUITE) {
    throw new CapsuleError(
      "CAPSULE_UNSUPPORTED_SUITE",
      "Capsule algorithm suite is unsupported",
    );
  }
  const flags = view.getUint16(6);
  if ((flags & ~CAPSULE_KNOWN_FLAGS) !== 0) malformed("Capsule flags are unsupported");
  const headerLength = view.getUint32(8);
  const metadataCiphertextLength = view.getUint32(12);
  const contentCiphertextLength = view.getUint32(16);
  const ownerWrapLength = view.getUint16(20);
  const recipientCount = view.getUint16(22);
  const hasRecovery = (flags & CAPSULE_FLAG_OWNER_RECOVERY) !== 0;

  if (
    headerLength < CAPSULE_FIXED_HEADER_BYTES ||
    headerLength > CAPSULE_MAX_HEADER_BYTES ||
    headerLength > bytes.byteLength
  ) {
    malformed("Capsule header length is invalid");
  }
  if (
    metadataCiphertextLength < CAPSULE_GCM_TAG_BYTES ||
    metadataCiphertextLength > CAPSULE_MAX_METADATA_BYTES + CAPSULE_GCM_TAG_BYTES ||
    contentCiphertextLength < CAPSULE_GCM_TAG_BYTES
  ) {
    malformed("Capsule encrypted-section length is invalid");
  }
  if (recipientCount > CAPSULE_MAX_RECIPIENTS) malformed("Capsule has too many recipients");
  if (
    (hasRecovery && ownerWrapLength !== CAPSULE_OWNER_WRAP_BYTES) ||
    (!hasRecovery && ownerWrapLength !== 0)
  ) {
    malformed("Capsule owner envelope length is invalid");
  }
  if (view.getUint32(64) !== 0) malformed("Capsule reserved bytes are not zero");

  const recoverySalt = copyBytes(bytes, 24, 24 + CAPSULE_RECOVERY_SALT_BYTES);
  if (!hasRecovery && recoverySalt.some((value) => value !== 0)) {
    malformed("Capsule recovery salt is present without owner recovery");
  }
  const metadataIv = copyBytes(bytes, 40, 40 + CAPSULE_IV_BYTES);
  const contentIv = copyBytes(bytes, 52, 52 + CAPSULE_IV_BYTES);
  if (bytesEqual(metadataIv, contentIv)) malformed("Capsule IVs must be distinct");

  let offset = CAPSULE_FIXED_HEADER_BYTES;
  let ownerWrappedKey: Uint8Array<ArrayBuffer> | undefined;
  if (hasRecovery) {
    ownerWrappedKey = copyBytes(bytes, offset, offset + ownerWrapLength);
    offset += ownerWrapLength;
  }

  const recipientEnvelopes: RecipientEnvelope[] = [];
  const seenRecipients = new Set<string>();
  for (let index = 0; index < recipientCount; index += 1) {
    if (offset + CAPSULE_RECIPIENT_FIXED_BYTES > headerLength) {
      malformed("Capsule recipient table is truncated");
    }
    if (view.getUint8(offset) !== CAPSULE_RECIPIENT_ALGORITHM_RSA_OAEP_256) {
      malformed("Capsule recipient algorithm is unsupported");
    }
    const keyVersion = view.getUint32(offset + 1);
    if (keyVersion === 0) malformed("Capsule recipient key version is invalid");
    const fingerprintBytes = copyBytes(
      bytes,
      offset + 5,
      offset + 5 + CAPSULE_FINGERPRINT_BYTES,
    );
    const fingerprint = bytesToHex(fingerprintBytes);
    const wrappedKeyLength = view.getUint16(offset + 37);
    assertWrappedKeyLength(wrappedKeyLength);
    const wrappedKeyOffset = offset + CAPSULE_RECIPIENT_FIXED_BYTES;
    if (wrappedKeyOffset + wrappedKeyLength > headerLength) {
      malformed("Capsule recipient wrapped key is truncated");
    }
    const identity = `${keyVersion}:${fingerprint}`;
    if (seenRecipients.has(identity)) malformed("Capsule has a duplicate recipient");
    seenRecipients.add(identity);
    recipientEnvelopes.push({
      keyVersion,
      fingerprint,
      wrappedKey: copyBytes(
        bytes,
        wrappedKeyOffset,
        wrappedKeyOffset + wrappedKeyLength,
      ),
    });
    offset = wrappedKeyOffset + wrappedKeyLength;
  }
  if (offset !== headerLength) malformed("Capsule header contains trailing bytes");

  const expectedLength =
    headerLength + metadataCiphertextLength + contentCiphertextLength;
  if (expectedLength !== bytes.byteLength) malformed("Capsule total length is invalid");
  if (!hasRecovery && recipientEnvelopes.length === 0) {
    malformed("Capsule has no access envelope");
  }

  const metadataStart = headerLength;
  const contentStart = metadataStart + metadataCiphertextLength;
  const header: CapsuleHeader = {
    version: 1,
    suite: 1,
    hasRecovery,
    headerLength,
    metadataCiphertextLength,
    contentCiphertextLength,
    recipientCount,
    recipients: recipientEnvelopes.map((recipient) => ({
      keyVersion: recipient.keyVersion,
      fingerprint: recipient.fingerprint,
      wrappedKeyLength: recipient.wrappedKey.byteLength,
    })),
  };
  return {
    header,
    headerBytes: copyBytes(bytes, 0, headerLength),
    recoverySalt,
    metadataIv,
    contentIv,
    ...(ownerWrappedKey === undefined ? {} : { ownerWrappedKey }),
    recipientEnvelopes,
    metadataCiphertext: copyBytes(bytes, metadataStart, contentStart),
    contentCiphertext: copyBytes(bytes, contentStart),
  };
}

export function parseCapsuleHeader(bytes: Uint8Array): CapsuleHeader {
  return parseCapsule(bytes).header;
}

export function parseCapsuleBytes(bytes: Uint8Array): ParsedCapsule {
  return parseCapsule(bytes);
}

export function serializeCapsuleHeader(
  input: SerializeHeaderInput,
): Uint8Array<ArrayBuffer> {
  if (
    input.recoverySalt.byteLength !== CAPSULE_RECOVERY_SALT_BYTES ||
    input.metadataIv.byteLength !== CAPSULE_IV_BYTES ||
    input.contentIv.byteLength !== CAPSULE_IV_BYTES ||
    bytesEqual(input.metadataIv, input.contentIv)
  ) {
    malformed("Capsule cryptographic parameters are invalid");
  }
  const hasRecovery = input.ownerWrappedKey !== undefined;
  if (
    (hasRecovery && input.ownerWrappedKey!.byteLength !== CAPSULE_OWNER_WRAP_BYTES) ||
    (!hasRecovery && input.recoverySalt.some((value) => value !== 0))
  ) {
    malformed("Capsule owner envelope is invalid");
  }
  if (input.recipientEnvelopes.length > CAPSULE_MAX_RECIPIENTS) {
    malformed("Capsule has too many recipients");
  }
  const identities = new Set<string>();
  let headerLength =
    CAPSULE_FIXED_HEADER_BYTES + (input.ownerWrappedKey?.byteLength ?? 0);
  for (const recipient of input.recipientEnvelopes) {
    if (recipient.keyVersion <= 0 || recipient.keyVersion > 0xffff_ffff) {
      malformed("Capsule recipient key version is invalid");
    }
    const fingerprint = hexToBytes(recipient.fingerprint);
    if (fingerprint.byteLength !== CAPSULE_FINGERPRINT_BYTES) {
      malformed("Capsule recipient fingerprint is invalid");
    }
    assertWrappedKeyLength(recipient.wrappedKey.byteLength);
    const identity = `${recipient.keyVersion}:${recipient.fingerprint}`;
    if (identities.has(identity)) malformed("Capsule has a duplicate recipient");
    identities.add(identity);
    headerLength += CAPSULE_RECIPIENT_FIXED_BYTES + recipient.wrappedKey.byteLength;
  }
  if (headerLength > CAPSULE_MAX_HEADER_BYTES) malformed("Capsule header is too large");

  const header = new Uint8Array(headerLength);
  header.set(CAPSULE_MAGIC, 0);
  const view = new DataView(header.buffer);
  view.setUint8(4, CAPSULE_VERSION);
  view.setUint8(5, CAPSULE_SUITE);
  view.setUint16(6, hasRecovery ? CAPSULE_FLAG_OWNER_RECOVERY : 0);
  view.setUint32(8, headerLength);
  view.setUint32(12, input.metadataCiphertextLength);
  view.setUint32(16, input.contentCiphertextLength);
  view.setUint16(20, input.ownerWrappedKey?.byteLength ?? 0);
  view.setUint16(22, input.recipientEnvelopes.length);
  header.set(input.recoverySalt, 24);
  header.set(input.metadataIv, 40);
  header.set(input.contentIv, 52);

  let offset = CAPSULE_FIXED_HEADER_BYTES;
  if (input.ownerWrappedKey !== undefined) {
    header.set(input.ownerWrappedKey, offset);
    offset += input.ownerWrappedKey.byteLength;
  }
  for (const recipient of input.recipientEnvelopes) {
    view.setUint8(offset, CAPSULE_RECIPIENT_ALGORITHM_RSA_OAEP_256);
    view.setUint32(offset + 1, recipient.keyVersion);
    header.set(hexToBytes(recipient.fingerprint), offset + 5);
    view.setUint16(offset + 37, recipient.wrappedKey.byteLength);
    header.set(recipient.wrappedKey, offset + CAPSULE_RECIPIENT_FIXED_BYTES);
    offset += CAPSULE_RECIPIENT_FIXED_BYTES + recipient.wrappedKey.byteLength;
  }
  return header;
}
