export { CapsuleError, type CapsuleErrorCode } from "./errors.js";
export {
  PERSONAL_FILE_IV_BYTES,
  PERSONAL_FILE_MIN_BYTES,
  PERSONAL_FILE_TAG_BYTES,
  decryptPersonalFile,
  decryptPersonalFileWithRecoveryPhrase,
  derivePersonalFileKey,
  normalizeRecoveryPhrase,
} from "./personal-file.js";
