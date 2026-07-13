import { createCapsule, openCapsule } from "../dist/index.js";
import { mnemonicToSeedWebcrypto } from "@scure/bip39";

const api = {
  async seed(recoveryPhrase: string) {
    return Array.from(await mnemonicToSeedWebcrypto(recoveryPhrase));
  },
  async create(plaintext: number[], recoveryPhrase: string) {
    const bytes = Uint8Array.from(plaintext);
    const created = await createCapsule({
      plaintext: bytes,
      metadata: {
        name: "browser.bin",
        mimeType: "application/octet-stream",
        size: bytes.byteLength,
      },
      recoveryPhrase,
    });
    return Array.from(created.bytes);
  },
  async open(capsule: number[], recoveryPhrase: string) {
    const opened = await openCapsule({
      capsule: Uint8Array.from(capsule),
      recoveryPhrase,
    });
    return {
      plaintext: Array.from(opened.plaintext),
      metadata: opened.metadata,
      access: opened.access,
    };
  },
};

Object.assign(globalThis, { capsuleTestApi: api });
