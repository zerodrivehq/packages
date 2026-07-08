export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type RecoveryItemType =
  | "personal-file"
  | "shared-file"
  | "private-key-backup";

export interface RecoveryItemMetadata extends JsonObject {
  encrypted: true;
}

export interface RecoveryKeyHint extends JsonObject {
  kind:
    | "recovery-phrase"
    | "recipient-private-key"
    | "wrapped-private-key"
    | "unknown";
  keyVersion?: number;
  publicKeyFingerprint?: string;
}

export interface RecoveryManifestItem extends JsonObject {
  id: string;
  type: RecoveryItemType;
  capsulePath: string;
  metadata?: RecoveryItemMetadata;
  encryptedSize?: number;
  sha256?: string;
  keyHint?: RecoveryKeyHint;
}

export interface RecoveryManifestV1 extends JsonObject {
  version: 1;
  createdAt: string;
  app: string;
  items: RecoveryManifestItem[];
}

export type RecoveryManifest = RecoveryManifestV1;

export interface CreateRecoveryManifestInput {
  app?: string;
  createdAt?: Date | string;
  items: RecoveryManifestItem[];
}

export interface RecoveryManifestValidationResult {
  ok: boolean;
  manifest?: RecoveryManifest;
  issues: import("./errors.ts").RecoveryValidationIssue[];
}

export interface RecoveryManifestSummary {
  version: 1;
  app: string;
  createdAt: string;
  totalItems: number;
  itemTypes: Record<RecoveryItemType, number>;
  encryptedBytes: number | null;
}

export interface OpenCapsuleResult {
  plaintext: ArrayBuffer | Uint8Array;
  metadata?: JsonObject;
}

export interface RestoreCapsuleItemInput {
  item: RecoveryManifestItem;
  capsuleBytes: ArrayBuffer | Uint8Array;
  openCapsule: (input: {
    item: RecoveryManifestItem;
    capsuleBytes: ArrayBuffer | Uint8Array;
  }) => Promise<OpenCapsuleResult>;
}

export interface RestoredCapsuleItem {
  item: RecoveryManifestItem;
  plaintext: Uint8Array;
  metadata?: JsonObject;
}
