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
  OpenPrivateKeyBackupInput,
  RecipientKeyPair,
} from "./types.js";
