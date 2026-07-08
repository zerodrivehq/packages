import { RecoveryError } from "./errors.ts";
import { validateRecoveryManifest } from "./manifest.ts";
import type {
  RestoredCapsuleItem,
  RestoreCapsuleItemInput,
} from "./types.ts";

function toUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export async function restoreCapsuleItem(
  input: RestoreCapsuleItemInput,
): Promise<RestoredCapsuleItem> {
  const itemValidation = validateRecoveryManifest({
    version: 1,
    createdAt: new Date(0).toISOString(),
    app: "zerodrive",
    items: [input.item],
  });

  if (!itemValidation.ok) {
    throw new RecoveryError(
      "RECOVERY_ITEM_INVALID",
      "Recovery item is malformed",
      itemValidation.issues.map((issue) => ({
        path: issue.path.replace("$.items[0]", "$.item"),
        message: issue.message,
      })),
    );
  }

  try {
    const opened = await input.openCapsule({
      item: input.item,
      capsuleBytes: input.capsuleBytes,
    });
    const restored: RestoredCapsuleItem = {
      item: input.item,
      plaintext: toUint8Array(opened.plaintext),
    };
    if (opened.metadata !== undefined) {
      restored.metadata = opened.metadata;
    }
    return restored;
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError(
      "RECOVERY_RESTORE_FAILED",
      "Recovery item could not be restored",
    );
  }
}
