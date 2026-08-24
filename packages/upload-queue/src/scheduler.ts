import { UploadQueueCanceledError } from "./errors.js";

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new UploadQueueCanceledError();
}

export class CommitScheduler {
  readonly #tails = new Map<string, Promise<void>>();

  async run<TResult>(
    key: string,
    signal: AbortSignal,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#tails.set(key, current);

    try {
      await previous;
      throwIfAborted(signal);
      return await operation();
    } finally {
      release();
      if (this.#tails.get(key) === current) this.#tails.delete(key);
    }
  }
}
