import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { chromium } from "@playwright/test";
import { mnemonicToSeedWebcrypto } from "@scure/bip39";
import { build } from "esbuild";

import {
  createCapsule,
  createZeroDrivePersonalFileCapsule,
  openCapsule,
  openZeroDriveVaultIndex,
} from "../dist/index.js";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

test("capsules interoperate between Node and browsers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zerodrive-browser-test-"));
  const bundle = join(directory, "capsule-browser.js");
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
        body: "<!doctype html><title>Capsule browser test</title>",
        contentType: "text/html",
      }),
    );
    await page.goto("http://localhost/");
    await page.addScriptTag({ path: bundle });

    const browserSeed = await page.evaluate(async (phrase) => {
      const api = (globalThis as typeof globalThis & {
        capsuleTestApi: { seed(recoveryPhrase: string): Promise<number[]> };
      }).capsuleTestApi;
      return api.seed(phrase);
    }, PHRASE);
    assert.deepEqual(
      browserSeed,
      Array.from(await mnemonicToSeedWebcrypto(PHRASE)),
    );

    const nodePlaintext = new TextEncoder().encode("created in Node");
    const nodeCapsule = await createCapsule({
      plaintext: nodePlaintext,
      metadata: {
        name: "node.txt",
        mimeType: "text/plain",
        size: nodePlaintext.byteLength,
      },
      recoveryPhrase: PHRASE,
    });
    const openedInBrowser = await page.evaluate(
      async ({ capsule, phrase }) => {
        const api = (globalThis as typeof globalThis & {
          capsuleTestApi: {
            open(bytes: number[], recoveryPhrase: string): Promise<{
              plaintext: number[];
              metadata: { name: string };
              access: { kind: string };
            }>;
          };
        }).capsuleTestApi;
        return api.open(capsule, phrase);
      },
      { capsule: Array.from(nodeCapsule.bytes), phrase: PHRASE },
    );
    assert.deepEqual(openedInBrowser.plaintext, Array.from(nodePlaintext));
    assert.equal(openedInBrowser.metadata.name, "node.txt");
    assert.equal(openedInBrowser.access.kind, "recovery-phrase");

    const browserPlaintext = [0, 1, 127, 128, 254, 255];
    const browserCapsule = await page.evaluate(
      async ({ plaintext, phrase }) => {
        const api = (globalThis as typeof globalThis & {
          capsuleTestApi: {
            create(bytes: number[], recoveryPhrase: string): Promise<number[]>;
          };
        }).capsuleTestApi;
        return api.create(plaintext, phrase);
      },
      { plaintext: browserPlaintext, phrase: PHRASE },
    );
    const openedInNode = await openCapsule({
      capsule: Uint8Array.from(browserCapsule),
      recoveryPhrase: PHRASE,
    });
    assert.deepEqual(Array.from(openedInNode.plaintext), browserPlaintext);
    assert.equal(openedInNode.metadata.name, "browser.bin");

    const zeroDriveContent = new TextEncoder().encode(
      "ZeroDrive adapter from Node",
    );
    const zeroDriveCapsule = await createZeroDrivePersonalFileCapsule({
      content: zeroDriveContent,
      metadata: { name: "adapter.txt", mimeType: "text/plain" },
      recoveryPhrase: PHRASE,
    });
    const adapterOpenedInBrowser = await page.evaluate(
      async ({ capsule, phrase }) => {
        const api = (globalThis as typeof globalThis & {
          capsuleTestApi: {
            openZeroDrivePersonal(
              bytes: number[],
              recoveryPhrase: string,
            ): Promise<{
              content: number[];
              metadata: { name: string };
              format: string;
            }>;
          };
        }).capsuleTestApi;
        return api.openZeroDrivePersonal(capsule, phrase);
      },
      { capsule: Array.from(zeroDriveCapsule), phrase: PHRASE },
    );
    assert.deepEqual(
      adapterOpenedInBrowser.content,
      Array.from(zeroDriveContent),
    );
    assert.equal(adapterOpenedInBrowser.metadata.name, "adapter.txt");
    assert.equal(adapterOpenedInBrowser.format, "capsule_v1");

    const browserVaultIndex = await page.evaluate(async (phrase) => {
      const api = (globalThis as typeof globalThis & {
        capsuleTestApi: {
          createZeroDriveVaultIndex(
            recoveryPhrase: string,
          ): Promise<number[]>;
        };
      }).capsuleTestApi;
      return api.createZeroDriveVaultIndex(phrase);
    }, PHRASE);
    const vaultOpenedInNode = await openZeroDriveVaultIndex({
      encryptedBytes: Uint8Array.from(browserVaultIndex),
      recoveryPhrase: PHRASE,
    });
    assert.deepEqual(vaultOpenedInNode.index, {
      files: [{ id: "browser-file" }],
      folders: [],
    });
  } finally {
    await browser.close();
  }
});
