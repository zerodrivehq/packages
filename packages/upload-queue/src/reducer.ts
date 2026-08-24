import type {
  UploadQueueEnqueueInput,
  UploadQueueTask,
} from "./types.js";

export type MutableUploadQueueTask<
  TSource,
  TMetadata,
  TResult,
> = {
  -readonly [Key in keyof UploadQueueTask<
    TSource,
    TMetadata,
    TResult
  >]: UploadQueueTask<TSource, TMetadata, TResult>[Key];
};

export function createWaitingTask<TSource, TMetadata, TResult>(
  id: string,
  source: TSource,
  input: UploadQueueEnqueueInput<TMetadata>,
  now: number,
): MutableUploadQueueTask<TSource, TMetadata, TResult> {
  return {
    id,
    source,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    name: input.name,
    ...(input.size === undefined ? {} : { size: input.size }),
    ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
    status: "waiting",
    progress: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function snapshotTask<TSource, TMetadata, TResult>(
  task: MutableUploadQueueTask<TSource, TMetadata, TResult>,
): UploadQueueTask<TSource, TMetadata, TResult> {
  return Object.freeze({
    ...task,
    ...(task.error === undefined
      ? {}
      : { error: Object.freeze({ ...task.error }) }),
    ...(task.cleanupError === undefined
      ? {}
      : { cleanupError: Object.freeze({ ...task.cleanupError }) }),
  });
}
