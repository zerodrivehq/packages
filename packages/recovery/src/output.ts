import { open, unlink, type FileHandle } from "node:fs/promises";

export interface PrivateOutputFileSystem {
  open(
    path: string,
    flags: string,
    mode: number,
  ): Promise<Pick<FileHandle, "close" | "sync" | "writeFile">>;
  unlink(path: string): Promise<void>;
}

const defaultFileSystem: PrivateOutputFileSystem = { open, unlink };

export async function writePrivateOutput(
  outputPath: string,
  plaintext: Uint8Array,
  fileSystem: PrivateOutputFileSystem = defaultFileSystem,
): Promise<void> {
  let handle:
    | Pick<FileHandle, "close" | "sync" | "writeFile">
    | undefined;
  let created = false;

  try {
    handle = await fileSystem.open(outputPath, "wx", 0o600);
    created = true;
    await handle.writeFile(plaintext);
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (created) {
      await fileSystem.unlink(outputPath).catch(() => undefined);
    }
    throw error;
  }
}
