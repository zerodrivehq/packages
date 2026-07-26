import type { JsonObject, JsonValue } from "../types.js";
import type { ZeroDriveEncryptedFormat } from "./formats.js";

export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
} from "../types.js";

export interface ZeroDriveOpenResult<
  TMetadata extends JsonObject = JsonObject,
> {
  content: Uint8Array;
  metadata: TMetadata;
  format: ZeroDriveEncryptedFormat;
}

export interface ZeroDriveVaultIndexResult<
  TIndex extends JsonValue = JsonValue,
> {
  index: TIndex;
  format: ZeroDriveEncryptedFormat;
}
