import type {
  UploadQueueOperation,
  UploadQueueTaskError,
} from "./types.js";

export interface UploadQueueErrorOptions {
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

export class UploadQueueError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    options: UploadQueueErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "UploadQueueError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export class UploadQueueCanceledError extends UploadQueueError {
  constructor() {
    super("TASK_CANCELED", "Upload task was canceled");
    this.name = "UploadQueueCanceledError";
  }
}

export function toUploadQueueTaskError(
  error: unknown,
  stage: UploadQueueOperation,
  attempt: number,
): UploadQueueTaskError {
  if (error instanceof UploadQueueError) {
    return Object.freeze({
      code: error.code,
      message: error.message,
      stage,
      retryable: error.retryable,
      attempt,
    });
  }
  return Object.freeze({
    code: "ADAPTER_FAILED",
    message: error instanceof Error ? error.message : "Upload operation failed",
    stage,
    retryable: false,
    attempt,
  });
}
