export type CapsuleErrorCode =
  | "INVALID_RECOVERY_PHRASE"
  | "INVALID_ENCRYPTED_FILE"
  | "DECRYPTION_FAILED"
  | "CAPSULE_ACCESS_REQUIRED"
  | "CAPSULE_AUTHENTICATION_FAILED"
  | "CAPSULE_KEY_INVALID"
  | "CAPSULE_KEY_UNWRAP_FAILED"
  | "CAPSULE_MALFORMED"
  | "CAPSULE_METADATA_INVALID"
  | "CAPSULE_NO_MATCHING_KEY"
  | "CAPSULE_RECIPIENT_INVALID"
  | "CAPSULE_UNSUPPORTED_SUITE"
  | "CAPSULE_UNSUPPORTED_VERSION"
  | "LEGACY_SHARED_FILE_INVALID";

export class CapsuleError extends Error {
  readonly code: CapsuleErrorCode;

  constructor(code: CapsuleErrorCode, message: string) {
    super(message);
    this.name = "CapsuleError";
    this.code = code;
  }
}
