export { CapsuleError, type CapsuleErrorCode } from "./errors.js";
export {
  CAPSULE_MAGIC,
  CAPSULE_MAX_METADATA_BYTES,
  CAPSULE_MAX_RECIPIENTS,
  CAPSULE_SUITE,
  CAPSULE_VERSION,
} from "./constants.js";
export { createCapsule, openCapsule } from "./capsule.js";
export { isCapsule, parseCapsuleHeader } from "./format.js";
export {
  fingerprintPublicKey,
  generateDataKey,
  generateRecipientKeyPair,
} from "./keys.js";
export {
  generateRecoveryPhrase,
  validateRecoveryPhrase,
} from "./recovery-phrase.js";
export {
  createPrivateKeyBackupCapsule,
  openLegacyPbkdf2PrivateKeyBackup,
  openLegacyPrivateKeyBackup,
  openPrivateKeyBackupCapsule,
} from "./private-key-backup.js";
export {
  isLegacySharedEnvelope,
  openLegacySharedFile,
} from "./legacy-shared.js";
export {
  PERSONAL_FILE_IV_BYTES,
  PERSONAL_FILE_MIN_BYTES,
  PERSONAL_FILE_TAG_BYTES,
  decryptPersonalFile,
  decryptPersonalFileWithRecoveryPhrase,
  derivePersonalFileKey,
  normalizeRecoveryPhrase,
} from "./personal-file.js";
export {
  ZERO_DRIVE_FORMATS,
  type ZeroDriveEncryptedFormat,
} from "./zerodrive/formats.js";
export {
  createZeroDrivePersonalFileCapsule,
  deriveZeroDriveLegacyVaultKey,
  openZeroDrivePersonalFile,
} from "./zerodrive/personal-file.js";
export {
  createZeroDriveVaultIndexCapsule,
  openZeroDriveVaultIndex,
} from "./zerodrive/vault-index.js";
export {
  createZeroDriveSharedFileCapsule,
  openZeroDriveSharedFile,
  type ZeroDriveSharedPrivateKey,
  type ZeroDriveSharedRecipient,
} from "./zerodrive/shared-file.js";
export {
  createZeroDriveSharedMetadataCapsule,
  openZeroDriveSharedMetadataCapsule,
} from "./zerodrive/shared-metadata.js";
export {
  createZeroDriveSharingKeyBackup,
  openZeroDriveSharingKeyBackup,
} from "./zerodrive/sharing-key-backup.js";
export type {
  ZeroDriveOpenResult,
  ZeroDriveSharedMetadataResult,
  ZeroDriveVaultIndexResult,
} from "./zerodrive/types.js";
export type {
  CapsuleAccess,
  CapsuleHeader,
  CapsuleMetadata,
  CapsulePrivateKey,
  CapsuleRecipient,
  CapsuleRecipientHeader,
  CreateCapsuleInput,
  CreatedCapsule,
  CreatePrivateKeyBackupInput,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  OpenCapsuleInput,
  OpenedCapsule,
  OpenedLegacySharedFile,
  OpenedPrivateKeyBackup,
  OpenLegacySharedFileInput,
  OpenLegacySharedMetadataInput,
  OpenPrivateKeyBackupInput,
  OpenedLegacySharedMetadata,
  RecipientKeyPair,
} from "./types.js";
