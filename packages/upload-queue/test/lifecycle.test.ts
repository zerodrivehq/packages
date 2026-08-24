import assert from "node:assert/strict";
import test from "node:test";

import { createUploadQueue } from "../dist/index.js";
import { deferred, waitForStatus } from "./helpers.ts";

test("runs prepare, upload, commit, and cleanup in order", async () => {
  const calls: string[] = [];
  const progress: number[] = [];
  const queue = createUploadQueue({
    adapter: {
      prepare: async (_task, context) => {
        calls.push("prepare");
        context.reportProgress(0.5);
        return { encrypted: true };
      },
      upload: async (_task, prepared, context) => {
        assert.equal(prepared.encrypted, true);
        calls.push("upload");
        context.reportProgress(0.5);
        return { driveId: "drive-1" };
      },
      commit: async (_task, uploaded, context) => {
        assert.equal(uploaded.driveId, "drive-1");
        calls.push("commit");
        context.reportProgress(1);
        return { id: uploaded.driveId, committed: true };
      },
      cleanup: async (_task, artifacts, reason) => {
        calls.push("cleanup");
        assert.equal(reason, "complete");
        assert.equal(artifacts.prepared?.encrypted, true);
        assert.equal(artifacts.uploaded?.driveId, "drive-1");
        assert.equal(artifacts.result?.committed, true);
      },
    },
  });
  queue.subscribe((snapshot) => {
    const task = snapshot.tasks[0];
    if (task !== undefined) progress.push(task.progress);
  });
  const id = queue.enqueue("plain bytes", { name: "hello.txt" });
  queue.start();

  const completed = await waitForStatus(queue, id, "complete");
  assert.deepEqual(calls, ["prepare", "upload", "commit", "cleanup"]);
  assert.deepEqual(completed.result, { id: "drive-1", committed: true });
  assert.equal(completed.progress, 1);
  assert.equal(completed.attempts, 1);
  assert.equal(
    progress.every((value, index) => index === 0 || value >= progress[index - 1]!),
    true,
  );
  assert.equal(queue.clearCompleted(), 1);
  assert.equal(queue.getTask(id), undefined);
});

for (const failedStage of ["prepare", "upload", "commit"] as const) {
  test(`marks a non-retryable ${failedStage} failure as failed`, async () => {
    const queue = createUploadQueue({
      adapter: {
        prepare: async () => {
          if (failedStage === "prepare") throw new Error("prepare broke");
          return "prepared";
        },
        upload: async () => {
          if (failedStage === "upload") throw new Error("upload broke");
          return "uploaded";
        },
        commit: async () => {
          if (failedStage === "commit") throw new Error("commit broke");
          return "complete";
        },
      },
    });
    const id = queue.enqueue("source", { name: "failure.bin" });
    queue.start();

    const failed = await waitForStatus(queue, id, "failed");
    assert.equal(failed.error?.stage, failedStage);
    assert.equal(failed.error?.retryable, false);
    assert.match(failed.error?.message ?? "", new RegExp(failedStage));
  });
}

test("cancel aborts active work and cleans retained artifacts", async () => {
  const uploadStarted = deferred<void>();
  let cleanupReason: string | undefined;
  let cleanupPrepared: string | undefined;
  const queue = createUploadQueue({
    adapter: {
      prepare: async () => "encrypted-temp-file",
      upload: async (_task, _prepared, context) => {
        uploadStarted.resolve();
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener(
            "abort",
            () => reject(new Error("adapter observed abort")),
            { once: true },
          );
        });
        return "never";
      },
      commit: async () => "never",
      cleanup: async (_task, artifacts, reason) => {
        cleanupReason = reason;
        cleanupPrepared = artifacts.prepared;
      },
    },
  });
  const id = queue.enqueue("source", { name: "cancel.bin" });
  queue.start();
  await uploadStarted.promise;

  assert.equal(await queue.cancel(id), true);
  assert.equal(queue.getTask(id)?.status, "canceled");
  assert.equal(cleanupReason, "canceled");
  assert.equal(cleanupPrepared, "encrypted-temp-file");
  assert.equal(queue.clearCompleted(), 1);
});

test("a successful commit wins a cancellation race", async () => {
  const commitStarted = deferred<void>();
  const finishCommit = deferred<string>();
  const queue = createUploadQueue({
    adapter: {
      prepare: async () => "prepared",
      upload: async () => "uploaded",
      commit: async () => {
        commitStarted.resolve();
        return finishCommit.promise;
      },
    },
  });
  const id = queue.enqueue("source", { name: "commit-race.bin" });
  queue.start();
  await commitStarted.promise;
  const canceling = queue.cancel(id);
  finishCommit.resolve("committed");

  assert.equal(await canceling, true);
  const task = queue.getTask(id);
  assert.equal(task?.status, "complete");
  assert.equal(task?.result, "committed");
});

test("reports cleanup failure without discarding a committed result", async () => {
  const queue = createUploadQueue({
    adapter: {
      prepare: async () => "prepared",
      upload: async () => "uploaded",
      commit: async () => "committed",
      cleanup: async () => {
        throw new Error("Temporary file could not be removed");
      },
    },
  });
  const id = queue.enqueue("source", { name: "cleanup.bin" });
  queue.start();

  const completed = await waitForStatus(queue, id, "complete");
  assert.equal(completed.result, "committed");
  assert.equal(completed.cleanupError?.stage, "cleanup");
  assert.match(completed.cleanupError?.message ?? "", /could not be removed/);
});

test("pause waits for the active stage boundary and resume continues it", async () => {
  const finishPrepare = deferred<string>();
  let uploadCalls = 0;
  const queue = createUploadQueue({
    adapter: {
      prepare: async () => finishPrepare.promise,
      upload: async () => {
        uploadCalls += 1;
        return "uploaded";
      },
      commit: async () => "done",
    },
  });
  const id = queue.enqueue("source", { name: "pause.bin" });
  queue.start();
  await waitForStatus(queue, id, "preparing");
  assert.equal(queue.pause(id), true);
  finishPrepare.resolve("prepared");

  const paused = await waitForStatus(queue, id, "paused");
  assert.equal(paused.progress, 0.1);
  assert.equal(uploadCalls, 0);
  assert.equal(queue.resume(id), true);
  const completed = await waitForStatus(queue, id, "complete");
  assert.equal(completed.attempts, 1);
  assert.equal(uploadCalls, 1);
});
