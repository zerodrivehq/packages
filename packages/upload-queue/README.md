# @zerodrivehq/upload-queue

Headless upload workflow orchestration for web, mobile, desktop, and native clients.

The package schedules work through `prepare -> upload -> commit` stages. Applications provide an adapter for encryption, network transfer, storage, and metadata updates. The queue has no React, DOM, browser `File`, storage, network, cryptography, logging, analytics, or telemetry dependencies.

## Install

```bash
npm install @zerodrivehq/upload-queue
```

Node.js 24 or a modern runtime with `AbortController`, Web Crypto, and `queueMicrotask` is required.

## Example

```ts
import {
  UploadQueueError,
  type UploadQueueAdapter,
  createUploadQueue,
} from "@zerodrivehq/upload-queue";

interface UploadSource {
  readonly path: string;
  readonly size: number;
}

interface UploadMetadata {
  readonly vaultId: string;
}

const adapter: UploadQueueAdapter<
  UploadSource,
  EncryptedTemporaryFile,
  UploadedObject,
  VaultFileMetadata,
  UploadMetadata
> = {
  canRunNow: () => navigator.onLine,

  async prepare(task, context) {
    context.throwIfCanceled();
    return encryptSource(task.source, context.signal);
  },

  async upload(task, encryptedFile, context) {
    try {
      return await uploadEncryptedFile(encryptedFile, {
        signal: context.signal,
        onProgress: context.reportProgress,
      });
    } catch (cause) {
      throw new UploadQueueError("UPLOAD_TEMPORARY", "Upload failed", {
        retryable: true,
        cause,
      });
    }
  },

  async commit(task, uploaded) {
    return commitVaultMetadata(task.metadata!.vaultId, uploaded);
  },

  async cleanup(_task, artifacts) {
    await artifacts.prepared?.remove();
  },
};

const queue = createUploadQueue({
  adapter,
  concurrency: 2,
  serializeCommit: true,
  getCommitKey: (task) => task.metadata!.vaultId,
  retry: {
    maxAttempts: 3,
    backoffMs: (attempt) => Math.min(1_000 * 2 ** (attempt - 1), 15_000),
  },
});

queue.subscribe((snapshot) => renderUploadTray(snapshot));
queue.enqueue({ path: "/documents/report.pdf", size: 42 }, {
  name: "report.pdf",
  size: 42,
  mimeType: "application/pdf",
  metadata: { vaultId: "primary" },
});
queue.start();
```

## Retry Safety

Successful stage outputs are retained until the task completes or is canceled. If `commit` fails after `upload` succeeds, retry resumes at `commit`; it does not prepare or upload the file again.

Unknown adapter errors are non-retryable by default. Throw `UploadQueueError` with `retryable: true` only when repeating the current stage is safe. Upload adapters should use idempotency where a remote service may accept bytes but lose the response.

Automatic retry stops at `maxAttempts`. `queue.retry(taskId)` starts a new retry budget while preserving the last successful stage outputs. Failed tasks retain those artifacts for safe manual retry; cancel a failed task to run cleanup and release them.

## Scheduling

- `concurrency` limits active tasks.
- `serializeCommit: true` prevents overlapping commits.
- `getCommitKey` creates independent serialized commit lanes, such as one lane per vault.
- `canRunNow` returning `false` moves a task to `blocked` without consuming an attempt.
- Call `queue.wake()` when connectivity or another external prerequisite changes.
- `pause` takes effect after an active stage finishes and does not abort it.
- `cancel` aborts active adapter work and waits for cleanup.
- `stop` prevents new tasks from starting while active tasks finish.

Cancellation cannot undo a commit that the adapter has already completed. If a commit succeeds while cancellation is racing it, the task completes because its remote and local state is already authoritative.

`enqueue` returns the task ID. `getTask` and `getSnapshot` return structurally immutable queue-owned records, while `subscribe` immediately receives the current snapshot and returns an unsubscribe function. `clearCompleted` removes completed and fully canceled terminal tasks.

Cleanup runs before a task becomes complete and after cancellation. A cleanup failure is exposed as `cleanupError` without changing an otherwise authoritative completed result.

Progress reported through a stage context is local to that stage. The queue maps preparation to 0-10%, upload to 10-90%, and commit to 90-100%, keeping public progress monotonic.

## Persistence

Version 0.1 is an in-memory engine. Applications own persistence and must not assume arbitrary sources such as browser `File` objects can be serialized. Durable background work, source restoration, and platform scheduling belong in client-specific adapters or a future persistence contract.
