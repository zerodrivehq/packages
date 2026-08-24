import type { UploadQueueRetryOptions } from "./types.js";

const DEFAULT_MAX_ATTEMPTS = 3;

function defaultBackoffMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 15_000);
}

export function normalizeRetryOptions(
  input: Partial<UploadQueueRetryOptions> | undefined,
): UploadQueueRetryOptions {
  const maxAttempts = input?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError("retry.maxAttempts must be a positive integer");
  }
  return {
    maxAttempts,
    backoffMs: input?.backoffMs ?? defaultBackoffMs,
  };
}

export function getRetryDelay(
  retry: UploadQueueRetryOptions,
  attempt: number,
): number {
  const delay = retry.backoffMs(attempt);
  if (!Number.isFinite(delay) || delay < 0) {
    throw new TypeError("retry.backoffMs must return a non-negative number");
  }
  return delay;
}
