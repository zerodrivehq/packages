export type RecoveryErrorCode =
  | "RECOVERY_MANIFEST_MALFORMED"
  | "RECOVERY_MANIFEST_UNSUPPORTED_VERSION"
  | "RECOVERY_ITEM_INVALID"
  | "RECOVERY_RESTORE_FAILED";

export interface RecoveryValidationIssue {
  path: string;
  message: string;
}

export class RecoveryError extends Error {
  readonly code: RecoveryErrorCode;
  readonly issues: RecoveryValidationIssue[];

  constructor(
    code: RecoveryErrorCode,
    message: string,
    issues: RecoveryValidationIssue[] = [],
  ) {
    super(message);
    this.name = "RecoveryError";
    this.code = code;
    this.issues = issues;
  }
}
