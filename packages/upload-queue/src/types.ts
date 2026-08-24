export type UploadQueueTaskStatus =
  | "waiting"
  | "blocked"
  | "preparing"
  | "uploading"
  | "committing"
  | "complete"
  | "failed"
  | "paused"
  | "canceled";

export type UploadQueueStage = "prepare" | "upload" | "commit";

export type UploadQueueOperation =
  | UploadQueueStage
  | "availability"
  | "cleanup";

export interface UploadQueueTaskError {
  readonly code: string;
  readonly message: string;
  readonly stage: UploadQueueOperation;
  readonly retryable: boolean;
  readonly attempt: number;
}

export interface UploadQueueTask<
  TSource,
  TMetadata = unknown,
  TResult = unknown,
> {
  readonly id: string;
  readonly source: TSource;
  readonly metadata?: TMetadata;
  readonly name: string;
  readonly size?: number;
  readonly mimeType?: string;
  readonly status: UploadQueueTaskStatus;
  readonly progress: number;
  readonly attempts: number;
  readonly error?: UploadQueueTaskError;
  readonly cleanupError?: UploadQueueTaskError;
  readonly result?: TResult;
  readonly nextAttemptAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface UploadQueueEnqueueInput<TMetadata = unknown> {
  readonly id?: string;
  readonly name: string;
  readonly size?: number;
  readonly mimeType?: string;
  readonly metadata?: TMetadata;
}

export interface UploadQueueTaskContext {
  readonly stage: UploadQueueStage;
  readonly attempt: number;
  readonly signal: AbortSignal;
  reportProgress(progress: number): void;
  throwIfCanceled(): void;
}

export interface UploadQueueArtifacts<TPrepared, TUploaded, TResult> {
  readonly prepared?: TPrepared;
  readonly uploaded?: TUploaded;
  readonly result?: TResult;
}

export type UploadQueueCleanupReason = "complete" | "canceled";

export interface UploadQueueAdapter<
  TSource,
  TPrepared,
  TUploaded,
  TResult,
  TMetadata = unknown,
> {
  canRunNow?(
    task: UploadQueueTask<TSource, TMetadata, TResult>,
  ): boolean | Promise<boolean>;

  prepare(
    task: UploadQueueTask<TSource, TMetadata, TResult>,
    context: UploadQueueTaskContext,
  ): Promise<TPrepared>;

  upload(
    task: UploadQueueTask<TSource, TMetadata, TResult>,
    prepared: TPrepared,
    context: UploadQueueTaskContext,
  ): Promise<TUploaded>;

  commit(
    task: UploadQueueTask<TSource, TMetadata, TResult>,
    uploaded: TUploaded,
    context: UploadQueueTaskContext,
  ): Promise<TResult>;

  cleanup?(
    task: UploadQueueTask<TSource, TMetadata, TResult>,
    artifacts: UploadQueueArtifacts<TPrepared, TUploaded, TResult>,
    reason: UploadQueueCleanupReason,
  ): void | Promise<void>;
}

export interface UploadQueueRetryOptions {
  readonly maxAttempts: number;
  readonly backoffMs: (attempt: number) => number;
}

export interface UploadQueueClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CreateUploadQueueOptions<
  TSource,
  TPrepared,
  TUploaded,
  TResult,
  TMetadata = unknown,
> {
  readonly adapter: UploadQueueAdapter<
    TSource,
    TPrepared,
    TUploaded,
    TResult,
    TMetadata
  >;
  readonly concurrency?: number;
  readonly serializeCommit?: boolean;
  readonly getCommitKey?: (
    task: UploadQueueTask<TSource, TMetadata, TResult>,
  ) => string;
  readonly retry?: Partial<UploadQueueRetryOptions>;
  readonly clock?: UploadQueueClock;
  readonly createId?: () => string;
}

export interface UploadQueueSnapshot<
  TSource,
  TMetadata = unknown,
  TResult = unknown,
> {
  readonly running: boolean;
  readonly activeCount: number;
  readonly tasks: readonly UploadQueueTask<TSource, TMetadata, TResult>[];
}

export type UploadQueueListener<
  TSource,
  TMetadata = unknown,
  TResult = unknown,
> = (snapshot: UploadQueueSnapshot<TSource, TMetadata, TResult>) => void;

export interface UploadQueue<
  TSource,
  TPrepared,
  TUploaded,
  TResult,
  TMetadata = unknown,
> {
  enqueue(source: TSource, input: UploadQueueEnqueueInput<TMetadata>): string;
  start(): void;
  stop(): void;
  wake(taskId?: string): void;
  pause(taskId: string): boolean;
  resume(taskId: string): boolean;
  retry(taskId: string): boolean;
  cancel(taskId: string): Promise<boolean>;
  clearCompleted(): number;
  getTask(
    taskId: string,
  ): UploadQueueTask<TSource, TMetadata, TResult> | undefined;
  getSnapshot(): UploadQueueSnapshot<TSource, TMetadata, TResult>;
  subscribe(
    listener: UploadQueueListener<TSource, TMetadata, TResult>,
  ): () => void;
}
