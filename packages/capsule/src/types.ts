export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface CapsuleMetadata {
  name: string;
  mimeType: string;
  size: number;
  createdAt?: string;
  attributes?: JsonObject;
}

export interface CapsuleRecipient {
  publicKeyJwk: JsonWebKey;
  keyVersion: number;
}

export interface CapsulePrivateKey {
  privateKeyJwk: JsonWebKey;
  keyVersion: number;
}

export interface RecipientKeyPair {
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
}

export interface CapsuleRecipientHeader {
  keyVersion: number;
  fingerprint: string;
  wrappedKeyLength: number;
}

export interface CapsuleHeader {
  version: 1;
  suite: 1;
  hasRecovery: boolean;
  headerLength: number;
  metadataCiphertextLength: number;
  contentCiphertextLength: number;
  recipientCount: number;
  recipients: CapsuleRecipientHeader[];
}

export interface CreateCapsuleInput {
  plaintext: Uint8Array;
  metadata: CapsuleMetadata;
  recoveryPhrase?: string;
  recipients?: CapsuleRecipient[];
}

export interface CreatedCapsule {
  bytes: Uint8Array;
  header: CapsuleHeader;
}

export interface OpenCapsuleInput {
  capsule: Uint8Array;
  recoveryPhrase?: string;
  privateKeys?: CapsulePrivateKey[];
  recipientPrivateKeys?: CryptoKey[];
}

export type CapsuleAccess =
  | { kind: "recovery-phrase" }
  | { kind: "recipient"; keyVersion: number; fingerprint: string };

export interface OpenedCapsule {
  plaintext: Uint8Array;
  metadata: CapsuleMetadata;
  access: CapsuleAccess;
}

export interface CreatePrivateKeyBackupInput {
  privateKeyJwk: JsonWebKey;
  publicKeyJwk?: JsonWebKey;
  keyVersion: number;
  recoveryPhrase: string;
  fingerprint?: string;
  createdAt?: string;
}

export interface OpenPrivateKeyBackupInput {
  capsule: Uint8Array;
  recoveryPhrase: string;
}

export interface OpenedPrivateKeyBackup {
  privateKeyJwk: JsonWebKey;
  publicKeyJwk?: JsonWebKey;
  keyVersion: number;
  fingerprint: string;
}

export interface OpenLegacySharedFileInput {
  encryptedFile: Uint8Array;
  wrappedFileKey: string;
  privateKeyJwk?: JsonWebKey;
  privateKey?: CryptoKey;
  keyVersion?: number;
  encryptedMetadata?: string;
  fallbackMetadata?: { name: string; mimeType: string };
}

export interface OpenedLegacySharedFile {
  plaintext: Uint8Array;
  metadata: { name: string; mimeType: string; message?: string };
}
