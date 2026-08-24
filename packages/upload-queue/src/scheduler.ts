import { UploadQueueCanceledError } from "./errors.js";

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new UploadQueueCanceledError();
}

async function waitForTurn(
  previous: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);

  let rejectOnAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => reject(new UploadQueueCanceledError());
    signal.addEventListener("abort", rejectOnAbort, { once: true });
  });

  try {
    await Promise.race([previous, aborted]);
    throwIfAborted(signal);
  } finally {
    signal.removeEventListener("abort", rejectOnAbort);
  }
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
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = previous.then(
      () => slot,
      () => slot,
    );
    this.#tails.set(key, current);
    void current.then(() => {
      if (this.#tails.get(key) === current) this.#tails.delete(key);
    });

    try {
      await waitForTurn(previous, signal);
      return await operation();
    } finally {
      release();
    }
  }
}
