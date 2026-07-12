import assert from "node:assert/strict";
import test from "node:test";
import { mnemonicToSeedWebcrypto } from "@scure/bip39";

import {
  createPrivateKeyBackupCapsule,
  fingerprintPublicKey,
  generateRecipientKeyPair,
  openLegacyPrivateKeyBackup,
  openPrivateKeyBackupCapsule,
} from "../dist/index.js";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

test("creates and opens an owner-only RSA private-key backup", async () => {
  const pair = await generateRecipientKeyPair();
  const created = await createPrivateKeyBackupCapsule({
    privateKeyJwk: pair.privateKeyJwk,
    keyVersion: 7,
    recoveryPhrase: PHRASE,
  });
  assert.equal(created.header.hasRecovery, true);
  assert.equal(created.header.recipientCount, 0);

  const opened = await openPrivateKeyBackupCapsule({
    capsule: created.bytes,
    recoveryPhrase: PHRASE,
  });
  assert.equal(opened.keyVersion, 7);
  assert.equal(
    opened.fingerprint,
    await fingerprintPublicKey(pair.publicKeyJwk),
  );
  assert.equal(opened.privateKeyJwk.n, pair.privateKeyJwk.n);
  assert.equal(opened.privateKeyJwk.d, pair.privateKeyJwk.d);
});

test("opens an existing Google Drive RSA private-key backup", async () => {
  const pair = await generateRecipientKeyPair();
  const legacyPrivateKeyJwk = { ...pair.privateKeyJwk, alg: "RSA-OAEP" };
  const plaintext = new TextEncoder().encode(JSON.stringify(legacyPrivateKeyJwk));
  const seed = await mnemonicToSeedWebcrypto(PHRASE);
  const keyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", seed));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  const encrypted = new Uint8Array(12 + ciphertext.byteLength);
  encrypted.set(iv);
  encrypted.set(ciphertext, 12);
  seed.fill(0);
  keyBytes.fill(0);
  plaintext.fill(0);

  const opened = await openLegacyPrivateKeyBackup(encrypted, PHRASE, 5);
  assert.equal(opened.keyVersion, 5);
  assert.equal(opened.privateKeyJwk.n, pair.privateKeyJwk.n);
  assert.equal(opened.privateKeyJwk.d, pair.privateKeyJwk.d);
});
