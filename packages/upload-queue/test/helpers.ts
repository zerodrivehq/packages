import type {
  UploadQueue,
  UploadQueueSnapshot,
  UploadQueueTask,
  UploadQueueTaskStatus,
} from "../dist/index.js";

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function waitForTask<
  TSource,
  TPrepared,
  TUploaded,
  TResult,
  TMetadata,
>(
  queue: UploadQueue<TSource, TPrepared, TUploaded, TResult, TMetadata>,
  taskId: string,
  predicate: (
    task: UploadQueueTask<TSource, TMetadata, TResult>,
  ) => boolean,
  timeoutMs = 2_000,
): Promise<UploadQueueTask<TSource, TMetadata, TResult>> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for upload task ${taskId}`));
    }, timeoutMs);
    unsubscribe = queue.subscribe((snapshot) => {
      const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
      if (task === undefined || !predicate(task)) return;
      clearTimeout(timer);
      queueMicrotask(unsubscribe);
      resolve(task);
    });
  });
}

export function waitForStatus<
  TSource,
  TPrepared,
  TUploaded,
  TResult,
  TMetadata,
>(
  queue: UploadQueue<TSource, TPrepared, TUploaded, TResult, TMetadata>,
  taskId: string,
  status: UploadQueueTaskStatus,
): Promise<UploadQueueTask<TSource, TMetadata, TResult>> {
  return waitForTask(queue, taskId, (task) => task.status === status);
}

export function waitForSnapshot<
  TSource,
  TPrepared,
  TUploaded,
  TResult,
  TMetadata,
>(
  queue: UploadQueue<TSource, TPrepared, TUploaded, TResult, TMetadata>,
  predicate: (
    snapshot: UploadQueueSnapshot<TSource, TMetadata, TResult>,
  ) => boolean,
  timeoutMs = 2_000,
): Promise<UploadQueueSnapshot<TSource, TMetadata, TResult>> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for upload queue snapshot"));
    }, timeoutMs);
    unsubscribe = queue.subscribe((snapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timer);
      queueMicrotask(unsubscribe);
      resolve(snapshot);
    });
  });
}
