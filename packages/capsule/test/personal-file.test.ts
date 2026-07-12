import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CapsuleError,
  PERSONAL_FILE_MIN_BYTES,
  decryptPersonalFile,
  decryptPersonalFileWithRecoveryPhrase,
  derivePersonalFileKey,
  normalizeRecoveryPhrase,
} from "../dist/index.js";

interface CompatibilityVector {
  name: string;
  plaintextBase64: string;
  encryptedBase64: string;
}

interface CompatibilityFixture {
  recoveryPhrase: string;
  derivedKeyHex: string;
  vectors: CompatibilityVector[];
}

const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/personal-file-v1.json", import.meta.url),
    "utf8",
  ),
) as CompatibilityFixture;

function bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function expectCapsuleCode(code: CapsuleError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof CapsuleError && error.code === code;
}

test("normalizes surrounding and repeated recovery phrase whitespace", () => {
  assert.equal(
    normalizeRecoveryPhrase(`  ${fixture.recoveryPhrase.replaceAll(" ", "  \n")}  `),
    fixture.recoveryPhrase,
  );
});

test("derives a non-extractable AES-256-GCM decryption key", async () => {
  const key = await derivePersonalFileKey(fixture.recoveryPhrase);
  assert.equal(key.extractable, false);
  assert.deepEqual(key.usages, ["decrypt"]);
  assert.equal(key.algorithm.name, "AES-GCM");
  assert.equal((key.algorithm as AesKeyAlgorithm).length, 256);
  await assert.rejects(
    globalThis.crypto.subtle.exportKey("raw", key),
    /extractable/i,
  );
});

for (const vector of fixture.vectors) {
  test(`decrypts the web-app ${vector.name} compatibility vector`, async () => {
    const encrypted = bytes(vector.encryptedBase64);
    const before = encrypted.slice();
    const plaintext = await decryptPersonalFileWithRecoveryPhrase(
      encrypted,
      fixture.recoveryPhrase,
    );
    assert.deepEqual(plaintext, bytes(vector.plaintextBase64));
    assert.deepEqual(encrypted, before, "caller-owned ciphertext must not be mutated");
  });
}

test("accepts harmless recovery phrase whitespace", async () => {
  const vector = fixture.vectors[0]!;
  const plaintext = await decryptPersonalFileWithRecoveryPhrase(
    bytes(vector.encryptedBase64),
    `\n ${fixture.recoveryPhrase.replaceAll(" ", "   ")} \t`,
  );
  assert.deepEqual(plaintext, bytes(vector.plaintextBase64));
});

test("decrypts with an explicitly derived personal-file key", async () => {
  const vector = fixture.vectors[1]!;
  const key = await derivePersonalFileKey(fixture.recoveryPhrase);
  const plaintext = await decryptPersonalFile(bytes(vector.encryptedBase64), key);
  assert.deepEqual(plaintext, bytes(vector.plaintextBase64));
});

test("rejects an invalid recovery phrase", async () => {
  await assert.rejects(
    derivePersonalFileKey("not a valid recovery phrase"),
    expectCapsuleCode("INVALID_RECOVERY_PHRASE"),
  );
});

test("rejects a truncated personal file", async () => {
  const key = await derivePersonalFileKey(fixture.recoveryPhrase);
  await assert.rejects(
    decryptPersonalFile(new Uint8Array(PERSONAL_FILE_MIN_BYTES - 1), key),
    expectCapsuleCode("INVALID_ENCRYPTED_FILE"),
  );
});

test("uses one authentication failure for a wrong phrase", async () => {
  const vector = fixture.vectors[0]!;
  const wrongPhrase =
    "legal winner thank year wave sausage worth useful legal winner thank yellow";
  await assert.rejects(
    decryptPersonalFileWithRecoveryPhrase(
      bytes(vector.encryptedBase64),
      wrongPhrase,
    ),
    expectCapsuleCode("DECRYPTION_FAILED"),
  );
});

for (const [label, index] of [
  ["IV", 0],
  ["ciphertext", 12],
  ["authentication tag", -1],
] as const) {
  test(`rejects a modified ${label}`, async () => {
    const vector = fixture.vectors[0]!;
    const encrypted = bytes(vector.encryptedBase64);
    const mutationIndex = index < 0 ? encrypted.length + index : index;
    encrypted[mutationIndex]! ^= 0x01;
    await assert.rejects(
      decryptPersonalFileWithRecoveryPhrase(encrypted, fixture.recoveryPhrase),
      expectCapsuleCode("DECRYPTION_FAILED"),
    );
  });
}
