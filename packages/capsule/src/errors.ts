export type CapsuleErrorCode =
  | "INVALID_RECOVERY_PHRASE"
  | "INVALID_ENCRYPTED_FILE"
  | "DECRYPTION_FAILED";

export class CapsuleError extends Error {
  readonly code: CapsuleErrorCode;

  constructor(code: CapsuleErrorCode, message: string) {
    super(message);
    this.name = "CapsuleError";
    this.code = code;
  }
}
