import assert from "node:assert/strict";
import test from "node:test";

import {
  UploadQueueError,
  createUploadQueue,
} from "../dist/index.js";
import { waitForStatus, waitForTask } from "./helpers.ts";

function createFakeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  return {
    clock: {
      now: () => now,
      setTimeout(callback: () => void, delayMs: number) {
        const id = ++nextId;
        timers.set(id, { due: now + delayMs, callback });
        return id;
      },
      clearTimeout(handle: unknown) {
        timers.delete(handle as number);
      },
    },
    advance(milliseconds: number) {
      now += milliseconds;
      const ready = Array.from(timers.entries())
        .filter(([, timer]) => timer.due <= now)
        .sort((left, right) => left[1].due - right[1].due);
      for (const [id, timer] of ready) {
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

test("a failed commit retries only commit without duplicating upload", async () => {
  let prepareCalls = 0;
  let uploadCalls = 0;
  let commitCalls = 0;
  const queue = createUploadQueue({
    adapter: {
      prepare: async () => {
        prepareCalls += 1;
        return "prepared";
      },
      upload: async () => {
        uploadCalls += 1;
        return { driveId: "existing-upload" };
      },
      commit: async (_task, uploaded) => {
        commitCalls += 1;
        assert.equal(uploaded.driveId, "existing-upload");
        if (commitCalls === 1) {
          throw new UploadQueueError("INDEX_BUSY", "Vault index is busy", {
            retryable: true,
          });
        }
        return uploaded.driveId;
      },
    },
    retry: { maxAttempts: 3, backoffMs: () => 0 },
  });
  const id = queue.enqueue("source", { name: "safe-retry.bin" });
  queue.start();

  const completed = await waitForStatus(queue, id, "complete");
  assert.equal(completed.result, "existing-upload");
  assert.equal(completed.attempts, 2);
  assert.equal(prepareCalls, 1);
  assert.equal(uploadCalls, 1);
  assert.equal(commitCalls, 2);
});

test("automatic retries stop at maxAttempts and manual retry resets the budget", async () => {
  let prepareCalls = 0;
  let uploadCalls = 0;
  let shouldFail = true;
  const queue = createUploadQueue({
    adapter: {
      prepare: async () => {
        prepareCalls += 1;
        return "prepared";
      },
      upload: async () => {
        uploadCalls += 1;
        if (shouldFail) {
          throw new UploadQueueError("TEMPORARY", "Temporary upload error", {
            retryable: true,
          });
        }
        return "uploaded";
      },
      commit: async () => "done",
    },
    retry: { maxAttempts: 3, backoffMs: () => 0 },
  });
  const id = queue.enqueue("source", { name: "retry.bin" });
  queue.start();

  const failed = await waitForStatus(queue, id, "failed");
  assert.equal(failed.attempts, 3);
  assert.equal(failed.error?.code, "TEMPORARY");
  assert.equal(prepareCalls, 1);
  assert.equal(uploadCalls, 3);

  shouldFail = false;
  assert.equal(queue.retry(id), true);
  const completed = await waitForStatus(queue, id, "complete");
  assert.equal(completed.attempts, 4);
  assert.equal(prepareCalls, 1);
  assert.equal(uploadCalls, 4);
});

test("ordinary adapter errors are not retried automatically", async () => {
  let calls = 0;
  const queue = createUploadQueue({
    adapter: {
      prepare: async () => "prepared",
      upload: async () => {
        calls += 1;
        throw new Error("Invalid upload request");
      },
      commit: async () => "never",
    },
    retry: { maxAttempts: 5, backoffMs: () => 0 },
  });
  const id = queue.enqueue("source", { name: "invalid.bin" });
  queue.start();

  const failed = await waitForStatus(queue, id, "failed");
  assert.equal(failed.attempts, 1);
  assert.equal(failed.error?.retryable, false);
  assert.equal(calls, 1);
});

test("automatic retry waits for the configured backoff", async () => {
  const fake = createFakeClock();
  let uploadCalls = 0;
  const queue = createUploadQueue({
    clock: fake.clock,
    adapter: {
      prepare: async () => "prepared",
      upload: async () => {
        uploadCalls += 1;
        if (uploadCalls === 1) {
          throw new UploadQueueError("TEMPORARY", "Try later", {
            retryable: true,
          });
        }
        return "uploaded";
      },
      commit: async () => "done",
    },
    retry: { maxAttempts: 2, backoffMs: () => 100 },
  });
  const id = queue.enqueue("source", { name: "backoff.bin" });
  queue.start();
  const waiting = await waitForTask(
    queue,
    id,
    (task) => task.status === "waiting" && task.attempts === 1,
  );
  assert.equal(waiting.attempts, 1);
  assert.equal(waiting.nextAttemptAt, 100);

  fake.advance(99);
  await Promise.resolve();
  assert.equal(uploadCalls, 1);
  fake.advance(1);
  const completed = await waitForStatus(queue, id, "complete");
  assert.equal(completed.attempts, 2);
  assert.equal(uploadCalls, 2);
});

test("canRunNow blocks work without consuming attempts", async () => {
  let online = false;
  let prepareCalls = 0;
  const queue = createUploadQueue({
    adapter: {
      canRunNow: () => online,
      prepare: async () => {
        prepareCalls += 1;
        return "prepared";
      },
      upload: async () => "uploaded",
      commit: async () => "done",
    },
  });
  const id = queue.enqueue("source", { name: "offline.bin" });
  queue.start();

  const blocked = await waitForStatus(queue, id, "blocked");
  assert.equal(blocked.attempts, 0);
  assert.equal(prepareCalls, 0);
  online = true;
  queue.wake(id);
  const completed = await waitForStatus(queue, id, "complete");
  assert.equal(completed.attempts, 1);
  assert.equal(prepareCalls, 1);
});
