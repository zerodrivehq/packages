import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CAPSULE_MAX_METADATA_BYTES,
  CapsuleError,
  createCapsule,
  fingerprintPublicKey,
  generateDataKey,
  generateRecipientKeyPair,
  generateRecoveryPhrase,
  isCapsule,
  openCapsule,
  parseCapsuleHeader,
  validateRecoveryPhrase,
} from "../dist/index.js";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const WRONG_PHRASE =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

interface CapsuleFixture {
  recoveryPhrase: string;
  vectors: Array<{
    name: string;
    plaintextBase64: string;
    capsuleBase64: string;
    metadata: ReturnType<typeof metadata>;
  }>;
}

function expectCode(code: CapsuleError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof CapsuleError && error.code === code;
}

function metadata(size: number) {
  return {
    name: "document.bin",
    mimeType: "application/octet-stream",
    size,
    createdAt: "2026-07-12T00:00:00.000Z",
    attributes: { category: "test", nested: { safe: true } },
  };
}

test("opens committed capsule v1 compatibility vectors", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("./fixtures/capsule-v1.json", import.meta.url), "utf8"),
  ) as CapsuleFixture;
  for (const vector of fixture.vectors) {
    const capsule = Buffer.from(vector.capsuleBase64, "base64");
    const opened = await openCapsule({
      capsule,
      recoveryPhrase: fixture.recoveryPhrase,
    });
    assert.deepEqual(
      Buffer.from(opened.plaintext),
      Buffer.from(vector.plaintextBase64, "base64"),
      vector.name,
    );
    assert.deepEqual(opened.metadata, vector.metadata, vector.name);
  }
});

test("generates and validates a 12-word recovery phrase", () => {
  const phrase = generateRecoveryPhrase();
  assert.equal(phrase.split(" ").length, 12);
  assert.equal(validateRecoveryPhrase(phrase), true);
  assert.equal(validateRecoveryPhrase("not a phrase"), false);
});

test("generates a non-extractable AES-256-GCM data key", async () => {
  const key = await generateDataKey();
  assert.equal(key.extractable, false);
  assert.equal(key.algorithm.name, "AES-GCM");
  assert.equal((key.algorithm as AesKeyAlgorithm).length, 256);
  assert.deepEqual(key.usages, ["encrypt", "decrypt"]);
});

for (const [name, plaintext] of [
  ["text", new TextEncoder().encode("ZeroDrive capsule v1")],
  ["binary", new Uint8Array([0, 1, 2, 127, 128, 254, 255])],
  ["empty", new Uint8Array()],
] as const) {
  test(`creates and opens a phrase-only ${name} capsule`, async () => {
    const created = await createCapsule({
      plaintext,
      metadata: metadata(plaintext.byteLength),
      recoveryPhrase: PHRASE,
    });
    assert.equal(isCapsule(created.bytes), true);
    assert.equal(created.header.hasRecovery, true);
    assert.equal(created.header.recipientCount, 0);

    const opened = await openCapsule({
      capsule: created.bytes,
      recoveryPhrase: PHRASE,
    });
    assert.deepEqual(opened.plaintext, plaintext);
    assert.deepEqual(opened.metadata, metadata(plaintext.byteLength));
    assert.deepEqual(opened.access, { kind: "recovery-phrase" });
  });
}

test("opens a recipient-only capsule with the matching private key", async () => {
  const pair = await generateRecipientKeyPair();
  const plaintext = new TextEncoder().encode("recipient access");
  const created = await createCapsule({
    plaintext,
    metadata: metadata(plaintext.byteLength),
    recipients: [{ publicKeyJwk: pair.publicKeyJwk, keyVersion: 3 }],
  });
  const opened = await openCapsule({
    capsule: created.bytes,
    privateKeys: [{ privateKeyJwk: pair.privateKeyJwk, keyVersion: 3 }],
  });
  assert.deepEqual(opened.plaintext, plaintext);
  assert.equal(opened.access.kind, "recipient");
  if (opened.access.kind === "recipient") {
    assert.equal(opened.access.keyVersion, 3);
    assert.equal(
      opened.access.fingerprint,
      await fingerprintPublicKey(pair.publicKeyJwk),
    );
  }
});

test("supports owner recovery and multiple independent recipients", async () => {
  const [first, second] = await Promise.all([
    generateRecipientKeyPair(),
    generateRecipientKeyPair(),
  ]);
  const plaintext = new TextEncoder().encode("shared once, opened three ways");
  const created = await createCapsule({
    plaintext,
    metadata: metadata(plaintext.byteLength),
    recoveryPhrase: PHRASE,
    recipients: [
      { publicKeyJwk: first.publicKeyJwk, keyVersion: 1 },
      { publicKeyJwk: second.publicKeyJwk, keyVersion: 8 },
    ],
  });
  assert.equal(created.header.hasRecovery, true);
  assert.equal(created.header.recipientCount, 2);

  const results = await Promise.all([
    openCapsule({ capsule: created.bytes, recoveryPhrase: PHRASE }),
    openCapsule({
      capsule: created.bytes,
      privateKeys: [{ privateKeyJwk: first.privateKeyJwk, keyVersion: 1 }],
    }),
    openCapsule({
      capsule: created.bytes,
      privateKeys: [{ privateKeyJwk: second.privateKeyJwk, keyVersion: 8 }],
    }),
  ]);
  for (const result of results) assert.deepEqual(result.plaintext, plaintext);
});

test("rejects missing access, duplicate recipients, and invalid metadata", async () => {
  const plaintext = new Uint8Array([1]);
  await assert.rejects(
    createCapsule({ plaintext, metadata: metadata(1) }),
    expectCode("CAPSULE_ACCESS_REQUIRED"),
  );

  const pair = await generateRecipientKeyPair();
  await assert.rejects(
    createCapsule({
      plaintext,
      metadata: metadata(1),
      recipients: [
        { publicKeyJwk: pair.publicKeyJwk, keyVersion: 1 },
        { publicKeyJwk: pair.publicKeyJwk, keyVersion: 1 },
      ],
    }),
    expectCode("CAPSULE_RECIPIENT_INVALID"),
  );
  await assert.rejects(
    createCapsule({
      plaintext,
      metadata: metadata(1),
      recipients: Array.from({ length: 65 }, () => ({
        publicKeyJwk: pair.publicKeyJwk,
        keyVersion: 1,
      })),
    }),
    expectCode("CAPSULE_RECIPIENT_INVALID"),
  );
  await assert.rejects(
    createCapsule({
      plaintext,
      metadata: metadata(1),
      recipients: [{ publicKeyJwk: { kty: "RSA", n: "bad", e: "AQAB" }, keyVersion: 1 }],
    }),
    expectCode("CAPSULE_KEY_INVALID"),
  );

  await assert.rejects(
    createCapsule({
      plaintext,
      metadata: { ...metadata(1), size: 2 },
      recoveryPhrase: PHRASE,
    }),
    expectCode("CAPSULE_METADATA_INVALID"),
  );
  await assert.rejects(
    createCapsule({
      plaintext,
      metadata: {
        ...metadata(1),
        attributes: { oversized: "x".repeat(CAPSULE_MAX_METADATA_BYTES) },
      },
      recoveryPhrase: PHRASE,
    }),
    expectCode("CAPSULE_METADATA_INVALID"),
  );
});

test("rejects wrong owner and recipient credentials", async () => {
  const [recipient, wrongRecipient] = await Promise.all([
    generateRecipientKeyPair(),
    generateRecipientKeyPair(),
  ]);
  const created = await createCapsule({
    plaintext: new Uint8Array([1, 2, 3]),
    metadata: metadata(3),
    recoveryPhrase: PHRASE,
    recipients: [{ publicKeyJwk: recipient.publicKeyJwk, keyVersion: 2 }],
  });
  await assert.rejects(
    openCapsule({ capsule: created.bytes, recoveryPhrase: WRONG_PHRASE }),
    expectCode("CAPSULE_KEY_UNWRAP_FAILED"),
  );
  await assert.rejects(
    openCapsule({
      capsule: created.bytes,
      privateKeys: [
        { privateKeyJwk: wrongRecipient.privateKeyJwk, keyVersion: 2 },
      ],
    }),
    expectCode("CAPSULE_NO_MATCHING_KEY"),
  );
  await assert.rejects(
    openCapsule({
      capsule: created.bytes,
      privateKeys: [{ privateKeyJwk: recipient.privateKeyJwk, keyVersion: 9 }],
    }),
    expectCode("CAPSULE_NO_MATCHING_KEY"),
  );
});

test("authenticates the header, key envelope, metadata, and content", async () => {
  const created = await createCapsule({
    plaintext: new TextEncoder().encode("tamper target"),
    metadata: metadata(13),
    recoveryPhrase: PHRASE,
  });
  const header = parseCapsuleHeader(created.bytes);
  const mutations = [
    ["salt", 24],
    ["owner envelope", 68],
    ["metadata", header.headerLength],
    ["content", created.bytes.byteLength - 1],
  ] as const;
  for (const [, index] of mutations) {
    const tampered = created.bytes.slice();
    tampered[index]! ^= 0x01;
    await assert.rejects(
      openCapsule({ capsule: tampered, recoveryPhrase: PHRASE }),
      (error: unknown) =>
        error instanceof CapsuleError &&
        (error.code === "CAPSULE_KEY_UNWRAP_FAILED" ||
          error.code === "CAPSULE_AUTHENTICATION_FAILED"),
    );
  }
});

test("rejects malformed versions, suites, lengths, flags, IVs, and trailing bytes", async () => {
  const created = await createCapsule({
    plaintext: new Uint8Array([1, 2]),
    metadata: metadata(2),
    recoveryPhrase: PHRASE,
  });
  const cases: Array<[number, number, CapsuleError["code"]]> = [
    [4, 2, "CAPSULE_UNSUPPORTED_VERSION"],
    [5, 2, "CAPSULE_UNSUPPORTED_SUITE"],
    [6, 0x80, "CAPSULE_MALFORMED"],
    [64, 1, "CAPSULE_MALFORMED"],
  ];
  for (const [index, value, code] of cases) {
    const malformed = created.bytes.slice();
    malformed[index] = value;
    assert.throws(() => parseCapsuleHeader(malformed), expectCode(code));
  }

  const sameIv = created.bytes.slice();
  sameIv.set(sameIv.slice(40, 52), 52);
  assert.throws(
    () => parseCapsuleHeader(sameIv),
    expectCode("CAPSULE_MALFORMED"),
  );
  assert.throws(
    () => parseCapsuleHeader(created.bytes.slice(0, -1)),
    expectCode("CAPSULE_MALFORMED"),
  );
  const trailing = new Uint8Array(created.bytes.byteLength + 1);
  trailing.set(created.bytes);
  assert.throws(
    () => parseCapsuleHeader(trailing),
    expectCode("CAPSULE_MALFORMED"),
  );
});

test("random malformed capsule headers only produce typed errors", () => {
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(96));
    bytes.set([0x5a, 0x44, 0x43, 0x50], 0);
    try {
      parseCapsuleHeader(bytes);
      assert.fail("random malformed capsule unexpectedly parsed");
    } catch (error) {
      assert.ok(error instanceof CapsuleError);
    }
  }
});
