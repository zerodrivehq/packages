import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { chromium } from "@playwright/test";
import { build } from "esbuild";

test("upload queue runs in a browser without platform adapters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zerodrive-queue-browser-"));
  const bundle = join(directory, "upload-queue-browser.js");
  await build({
    entryPoints: [new URL("./browser-entry.ts", import.meta.url).pathname],
    bundle: true,
    format: "iife",
    outfile: bundle,
    platform: "browser",
    target: "es2023",
  });

  const browser = await chromium.launch({ channel: "chromium", headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://localhost/**", (route) =>
      route.fulfill({
        body: "<!doctype html><title>Upload queue browser test</title>",
        contentType: "text/html",
      }),
    );
    await page.goto("http://localhost/");
    await page.addScriptTag({ path: bundle });
    const result = await page.evaluate(async () => {
      const testApi = (
        globalThis as typeof globalThis & {
          uploadQueueTestApi: {
            run(): Promise<{
              blocked: string;
              completed: { status: string; result?: string; progress: number };
              lifecycle: string[];
            }>;
          };
        }
      ).uploadQueueTestApi;
      return testApi.run();
    });

    assert.equal(result.blocked, "blocked");
    assert.deepEqual(result.completed, {
      status: "complete",
      result: "browser-object",
      progress: 1,
    });
    assert.deepEqual(result.lifecycle, [
      "prepare:browser-source",
      "upload:encrypted:browser-source",
      "commit:browser-object",
    ]);
  } finally {
    await browser.close();
    await rm(directory, { force: true, recursive: true });
  }
});
