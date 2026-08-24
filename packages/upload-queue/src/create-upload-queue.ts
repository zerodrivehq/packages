import {
  UploadQueueCanceledError,
  toUploadQueueTaskError,
} from "./errors.js";
import {
  createWaitingTask,
  snapshotTask,
  type MutableUploadQueueTask,
} from "./reducer.js";
import { getRetryDelay, normalizeRetryOptions } from "./retry.js";
import { CommitScheduler } from "./scheduler.js";
import type {
  CreateUploadQueueOptions,
  UploadQueue,
  UploadQueueArtifacts,
  UploadQueueCleanupReason,
  UploadQueueClock,
  UploadQueueListener,
  UploadQueueOperation,
  UploadQueueSnapshot,
  UploadQueueStage,
  UploadQueueTask,
  UploadQueueTaskContext,
} from "./types.js";

const GLOBAL_COMMIT_KEY = "__global__";

const STAGE_PROGRESS: Record<
  UploadQueueStage,
  readonly [start: number, end: number]
> = {
  prepare: [0, 0.1],
  upload: [0.1, 0.9],
  commit: [0.9, 1],
};

const STATUS_FOR_STAGE: Record<
  UploadQueueStage,
  "preparing" | "uploading" | "committing"
> = {
  prepare: "preparing",
  upload: "uploading",
  commit: "committing",
};

const defaultClock: UploadQueueClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(
      handle as ReturnType<typeof globalThis.setTimeout>,
    );
  },
};

function defaultCreateId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    throw new TypeError("Upload progress must be a finite number");
  }
  return Math.min(1, Math.max(0, progress));
}

interface RuntimeTask<TSource, TPrepared, TUploaded, TResult, TMetadata> {
  readonly task: MutableUploadQueueTask<TSource, TMetadata, TResult>;
  nextStage: UploadQueueStage;
  prepared: TPrepared | undefined;
  uploaded: TUploaded | undefined;
  hasPrepared: boolean;
  hasUploaded: boolean;
  committed: boolean;
  running: boolean;
  pauseRequested: boolean;
  continuingAttempt: boolean;
  attemptsInCycle: number;
  controller: AbortController | undefined;
  runPromise: Promise<void> | undefined;
}

export function createUploadQueue<
  TSource,
  TPrepared,
  TUploaded,
  TResult,
  TMetadata = unknown,
>(
  options: CreateUploadQueueOptions<
    TSource,
    TPrepared,
    TUploaded,
    TResult,
    TMetadata
  >,
): UploadQueue<TSource, TPrepared, TUploaded, TResult, TMetadata> {
  const concurrency = options.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError("concurrency must be a positive integer");
  }

  const adapter = options.adapter;
  const serializeCommit = options.serializeCommit ?? true;
  const retry = normalizeRetryOptions(options.retry);
  const clock = options.clock ?? defaultClock;
  const createId = options.createId ?? defaultCreateId;
  const commitScheduler = new CommitScheduler();
  const runtimes = new Map<
    string,
    RuntimeTask<TSource, TPrepared, TUploaded, TResult, TMetadata>
  >();
  const listeners = new Set<
    UploadQueueListener<TSource, TMetadata, TResult>
  >();

  let started = false;
  let activeCount = 0;
  let scheduling = false;
  let scheduleQueued = false;
  let rescheduleRequested = false;
  let retryTimer: unknown;

  function getSnapshot(): UploadQueueSnapshot<TSource, TMetadata, TResult> {
    return Object.freeze({
      running: started,
      activeCount,
      tasks: Object.freeze(
        Array.from(runtimes.values(), (runtime) =>
          snapshotTask(runtime.task),
        ),
      ),
    });
  }

  function emit(): void {
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // Subscriber failures must not break queue execution.
      }
    }
  }

  function touch(
    task: MutableUploadQueueTask<TSource, TMetadata, TResult>,
  ): void {
    task.updatedAt = clock.now();
  }

  function clearRetryTimer(): void {
    if (retryTimer === undefined) return;
    clock.clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  function armRetryTimer(): void {
    clearRetryTimer();
    if (!started) return;
    const now = clock.now();
    let earliest: number | undefined;
    for (const { task } of runtimes.values()) {
      if (
        task.status !== "waiting" ||
        task.nextAttemptAt === undefined ||
        task.nextAttemptAt <= now
      ) {
        continue;
      }
      earliest =
        earliest === undefined
          ? task.nextAttemptAt
          : Math.min(earliest, task.nextAttemptAt);
    }
    if (earliest === undefined) return;
    retryTimer = clock.setTimeout(() => {
      retryTimer = undefined;
      requestSchedule();
    }, Math.max(0, earliest - now));
  }

  function requestSchedule(): void {
    if (scheduleQueued) return;
    scheduleQueued = true;
    queueMicrotask(() => {
      scheduleQueued = false;
      void schedule();
    });
  }

  function taskForAdapter(
    runtime: RuntimeTask<TSource, TPrepared, TUploaded, TResult, TMetadata>,
  ): UploadQueueTask<TSource, TMetadata, TResult> {
    return snapshotTask(runtime.task);
  }

  function createContext(
    runtime: RuntimeTask<TSource, TPrepared, TUploaded, TResult, TMetadata>,
    stage: UploadQueueStage,
    controller: AbortController,
  ): UploadQueueTaskContext {
    return Object.freeze({
      stage,
      attempt: runtime.task.attempts,
      signal: controller.signal,
      reportProgress: (progress: number) => {
        if (
          controller.signal.aborted ||
          runtime.controller !== controller ||
          runtime.task.status !== STATUS_FOR_STAGE[stage]
        ) {
          return;
        }
        const [start, end] = STAGE_PROGRESS[stage];
        const mapped = start + (end - start) * clampProgress(progress);
        if (mapped <= runtime.task.progress) return;
        runtime.task.progress = mapped;
        touch(runtime.task);
        emit();
      },
      throwIfCanceled: () => {
        if (
          controller.signal.aborted ||
          runtime.task.status === "canceled"
        ) {
          throw new UploadQueueCanceledError();
        }
      },
    });
  }

  function artifactsFor(
    runtime: RuntimeTask<TSource, TPrepared, TUploaded, TResult, TMetadata>,
  ): UploadQueueArtifacts<TPrepared, TUploaded, TResult> {
    return {
      ...(runtime.hasPrepared ? { prepared: runtime.prepared as TPrepared } : {}),
      ...(runtime.hasUploaded ? { uploaded: runtime.uploaded as TUploaded } : {}),
      ...(runtime.committed ? { result: runtime.task.result as TResult } : {}),
    };
  }

  async function cleanup(
    runtime: RuntimeTask<TSource, TPrepared, TUploaded, TResult, TMetadata>,
    reason: UploadQueueCleanupReason,
  ): Promise<void> {
    try {
      await adapter.cleanup?.(
        taskForAdapter(runtime),
        artifactsFor(runtime),
        reason,
      );
    } catch (error) {
      runtime.task.cleanupError = toUploadQueueTaskError(
        error,
        "cleanup",
        runtime.task.attempts,
      );
    } finally {
      runtime.prepared = undefined;
      runtime.uploaded = undefined;
      runtime.hasPrepared = false;
      runtime.hasUploaded = false;
      touch(runtime.task);
    }
  }

  function pauseAfterStage(
    runtime: RuntimeTask<TSource, TPrepared, TUploaded, TResult, TMetadata>,
  ): boolean {
    if (!runtime.pauseRequested) return false;
    runtime.pauseRequested = false;
    runtime.continuingAttempt = true;
    runtime.task.status = "paused";
    touch(runtime.task);
    emit();
    return true;
  }

  async function runStage(
    runtime: RuntimeTask<TSource, TPrepared, TUploaded, TResult, TMetadata>,
    stage: UploadQueueStage,
    controller: AbortController,
  ): Promise<void> {
    const context = createContext(runtime, stage, controller);
    const [start, end] = STAGE_PROGRESS[stage];
    runtime.task.status = STATUS_FOR_STAGE[stage];
    runtime.task.progress = Math.max(runtime.task.progress, start);
    touch(runtime.task);
    emit();

    if (stage === "prepare") {
      const prepared = await adapter.prepare(
        taskForAdapter(runtime),
        context,
      );
      runtime.prepared = prepared;
      runtime.hasPrepared = true;
      context.throwIfCanceled();
      runtime.nextStage = "upload";
    } else if (stage === "upload") {
      if (!runtime.hasPrepared) {
        throw new Error("Upload stage has no prepared artifact");
      }
      const uploaded = await adapter.upload(
        taskForAdapter(runtime),
        runtime.prepared as TPrepared,
        context,
      );
      runtime.uploaded = uploaded;
      runtime.hasUploaded = true;
      context.throwIfCanceled();
      runtime.nextStage = "commit";
    } else {
      if (!runtime.hasUploaded) {
        throw new Error("Commit stage has no uploaded artifact");
      }
      const operation = () =>
        adapter.commit(
          taskForAdapter(runtime),
          runtime.uploaded as TUploaded,
          context,
        );
      const result = serializeCommit
        ? await commitScheduler.run(
            options.getCommitKey?.(taskForAdapter(runtime)) ??
              GLOBAL_COMMIT_KEY,
            controller.signal,
            operation,
          )
        : await operation();
      runtime.task.result = result;
      runtime.committed = true;
    }

    runtime.task.progress = Math.max(runtime.task.progress, end);
    touch(runtime.task);
    emit();
  }

  function failTask(
    runtime: RuntimeTask<TSource, TPrepared, TUploaded, TResult, TMetadata>,
    error: unknown,
    stage: UploadQueueOperation,
  ): void {
    const taskError = toUploadQueueTaskError(
      error,
      stage,
      runtime.task.attempts,
    );
    runtime.task.error = taskError;
    runtime.continuingAttempt = false;

    if (
      taskError.retryable &&
      runtime.attemptsInCycle < retry.maxAttempts
    ) {
      try {
        const delay = getRetryDelay(retry, runtime.attemptsInCycle);
        runtime.task.status = "waiting";
        runtime.task.nextAttemptAt = clock.now() + delay;
      } catch (retryError) {
        runtime.task.error = toUploadQueueTaskError(
          retryError,
          stage,
          runtime.task.attempts,
        );
        runtime.task.status = "failed";
        delete runtime.task.nextAttemptAt;
      }
    } else {
      runtime.task.status = "failed";
      delete runtime.task.nextAttemptAt;
    }
    touch(runtime.task);
    emit();
  }

  async function execute(
    runtime: RuntimeTask<TSource, TPrepared, TUploaded, TResult, TMetadata>,
  ): Promise<void> {
    const controller = new AbortController();
    runtime.controller = controller;
    if (!runtime.continuingAttempt) {
      runtime.task.attempts += 1;
      runtime.attemptsInCycle += 1;
    }
    runtime.continuingAttempt = false;
    delete runtime.task.error;
    delete runtime.task.nextAttemptAt;

    try {
      while (!runtime.committed) {
        const stage = runtime.nextStage;
        try {
          await runStage(runtime, stage, controller);
        } catch (error) {
          if (
            controller.signal.aborted ||
            runtime.task.status === "canceled" ||
            error instanceof UploadQueueCanceledError
          ) {
            runtime.task.status = "canceled";
            delete runtime.task.error;
            await cleanup(runtime, "canceled");
            emit();
            return;
          }
          failTask(runtime, error, stage);
          return;
        }
        if (pauseAfterStage(runtime)) return;
      }

      await cleanup(runtime, "complete");
      runtime.task.status = "complete";
      runtime.task.progress = 1;
      delete runtime.task.error;
      delete runtime.task.nextAttemptAt;
      touch(runtime.task);
      emit();
    } finally {
      runtime.controller = undefined;
    }
  }

  function launch(
    runtime: RuntimeTask<TSource, TPrepared, TUploaded, TResult, TMetadata>,
  ): void {
    runtime.running = true;
    activeCount += 1;
    runtime.runPromise = execute(runtime).finally(() => {
      runtime.running = false;
      runtime.runPromise = undefined;
      activeCount -= 1;
      emit();
      requestSchedule();
    });
  }

  async function canRun(
    runtime: RuntimeTask<TSource, TPrepared, TUploaded, TResult, TMetadata>,
  ): Promise<boolean> {
    try {
      return (await adapter.canRunNow?.(taskForAdapter(runtime))) ?? true;
    } catch (error) {
      runtime.task.error = toUploadQueueTaskError(
        error,
        "availability",
        runtime.task.attempts,
      );
      runtime.task.status = "failed";
      touch(runtime.task);
      emit();
      return false;
    }
  }

  async function schedule(): Promise<void> {
    if (scheduling) {
      rescheduleRequested = true;
      return;
    }
    scheduling = true;
    clearRetryTimer();
    try {
      while (started && activeCount < concurrency) {
        const now = clock.now();
        const runtime = Array.from(runtimes.values()).find(
          ({ task, running }) =>
            !running &&
            task.status === "waiting" &&
            (task.nextAttemptAt === undefined || task.nextAttemptAt <= now),
        );
        if (runtime === undefined) break;

        const allowed = await canRun(runtime);
        if (!started || runtime.task.status !== "waiting") continue;
        if (!allowed) {
          runtime.task.status = "blocked";
          touch(runtime.task);
          emit();
          continue;
        }
        launch(runtime);
      }
      armRetryTimer();
    } finally {
      scheduling = false;
      if (rescheduleRequested) {
        rescheduleRequested = false;
        requestSchedule();
      }
    }
  }

  function wake(taskId?: string): void {
    let changed = false;
    for (const runtime of runtimes.values()) {
      if (
        runtime.task.status === "blocked" &&
        (taskId === undefined || runtime.task.id === taskId)
      ) {
        runtime.task.status = "waiting";
        touch(runtime.task);
        changed = true;
      }
    }
    if (changed) emit();
    requestSchedule();
  }

  return {
    enqueue(source, input) {
      if (input.name.trim().length === 0) {
        throw new TypeError("Upload task name must not be empty");
      }
      if (
        input.size !== undefined &&
        (!Number.isFinite(input.size) || input.size < 0)
      ) {
        throw new TypeError("Upload task size must be a non-negative number");
      }
      const id = input.id ?? createId();
      if (id.length === 0) throw new TypeError("Upload task id must not be empty");
      if (runtimes.has(id)) throw new TypeError(`Duplicate upload task id: ${id}`);
      const task = createWaitingTask<TSource, TMetadata, TResult>(
        id,
        source,
        input,
        clock.now(),
      );
      runtimes.set(id, {
        task,
        nextStage: "prepare",
        prepared: undefined,
        uploaded: undefined,
        hasPrepared: false,
        hasUploaded: false,
        committed: false,
        running: false,
        pauseRequested: false,
        continuingAttempt: false,
        attemptsInCycle: 0,
        controller: undefined,
        runPromise: undefined,
      });
      emit();
      requestSchedule();
      return id;
    },

    start() {
      started = true;
      for (const runtime of runtimes.values()) {
        if (runtime.task.status === "blocked") {
          runtime.task.status = "waiting";
          touch(runtime.task);
        }
      }
      emit();
      requestSchedule();
    },

    stop() {
      if (!started) return;
      started = false;
      clearRetryTimer();
      emit();
    },

    wake,

    pause(taskId) {
      const runtime = runtimes.get(taskId);
      if (runtime === undefined) return false;
      if (runtime.running) {
        if (runtime.committed) return false;
        runtime.pauseRequested = true;
        return true;
      }
      if (
        runtime.task.status !== "waiting" &&
        runtime.task.status !== "blocked"
      ) {
        return false;
      }
      runtime.task.status = "paused";
      touch(runtime.task);
      emit();
      armRetryTimer();
      return true;
    },

    resume(taskId) {
      const runtime = runtimes.get(taskId);
      if (runtime === undefined || runtime.task.status !== "paused") {
        return false;
      }
      runtime.pauseRequested = false;
      runtime.task.status = "waiting";
      touch(runtime.task);
      emit();
      requestSchedule();
      return true;
    },

    retry(taskId) {
      const runtime = runtimes.get(taskId);
      if (runtime === undefined || runtime.task.status !== "failed") {
        return false;
      }
      runtime.attemptsInCycle = 0;
      runtime.continuingAttempt = false;
      delete runtime.task.error;
      delete runtime.task.cleanupError;
      delete runtime.task.nextAttemptAt;
      runtime.task.status = "waiting";
      touch(runtime.task);
      emit();
      requestSchedule();
      return true;
    },

    async cancel(taskId) {
      const runtime = runtimes.get(taskId);
      if (
        runtime === undefined ||
        runtime.task.status === "complete" ||
        runtime.task.status === "canceled" ||
        runtime.committed
      ) {
        return false;
      }
      runtime.pauseRequested = false;
      runtime.task.status = "canceled";
      delete runtime.task.error;
      delete runtime.task.nextAttemptAt;
      touch(runtime.task);
      runtime.controller?.abort();
      emit();
      if (runtime.runPromise !== undefined) {
        await runtime.runPromise;
      } else {
        await cleanup(runtime, "canceled");
        emit();
      }
      requestSchedule();
      return true;
    },

    clearCompleted() {
      let removed = 0;
      for (const [id, runtime] of runtimes) {
        if (
          runtime.task.status === "complete" ||
          (!runtime.running && runtime.task.status === "canceled")
        ) {
          runtimes.delete(id);
          removed += 1;
        }
      }
      if (removed > 0) emit();
      return removed;
    },

    getTask(taskId) {
      const runtime = runtimes.get(taskId);
      return runtime === undefined ? undefined : snapshotTask(runtime.task);
    },

    getSnapshot,

    subscribe(listener) {
      listeners.add(listener);
      try {
        listener(getSnapshot());
      } catch {
        // Match subsequent notifications: subscriber failures stay isolated.
      }
      return () => listeners.delete(listener);
    },
  };
}
