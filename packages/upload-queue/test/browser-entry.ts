import { UploadQueueError, createUploadQueue } from "../dist/index.js";

const api = {
  async run() {
    const lifecycle: string[] = [];
    let online = false;
    const queue = createUploadQueue({
      adapter: {
        canRunNow: () => online,
        prepare: async (task, context) => {
          lifecycle.push(`prepare:${task.source}`);
          context.reportProgress(1);
          return `encrypted:${task.source}`;
        },
        upload: async (_task, prepared) => {
          lifecycle.push(`upload:${prepared}`);
          return { objectId: "browser-object" };
        },
        commit: async (_task, uploaded) => {
          lifecycle.push(`commit:${uploaded.objectId}`);
          return uploaded.objectId;
        },
      },
      retry: { maxAttempts: 2, backoffMs: () => 0 },
    });
    const taskId = queue.enqueue("browser-source", { name: "browser.txt" });
    queue.start();
    const blocked = await new Promise<string>((resolve) => {
      const unsubscribe = queue.subscribe((snapshot) => {
        const status = snapshot.tasks.find((task) => task.id === taskId)?.status;
        if (status !== "blocked") return;
        unsubscribe();
        resolve(status);
      });
    });
    online = true;
    queue.wake(taskId);
    const completed = await new Promise<{
      status: string;
      result?: string;
      progress: number;
    }>((resolve, reject) => {
      const unsubscribe = queue.subscribe((snapshot) => {
        const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
        if (task?.status === "failed") {
          unsubscribe();
          reject(
            new UploadQueueError(
              task.error?.code ?? "BROWSER_FAILED",
              task.error?.message ?? "Browser queue failed",
            ),
          );
        }
        if (task?.status !== "complete") return;
        unsubscribe();
        resolve({
          status: task.status,
          result: task.result,
          progress: task.progress,
        });
      });
    });
    return { blocked, completed, lifecycle };
  },
};

Object.assign(globalThis, { uploadQueueTestApi: api });
