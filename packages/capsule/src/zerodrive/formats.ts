export const ZERO_DRIVE_FORMATS = {
  CAPSULE_V1: "capsule_v1",
  LEGACY_PERSONAL_V1: "legacy_personal_v1",
  LEGACY_METADATA_V1: "legacy_metadata_v1",
  LEGACY_SHARED_ZDSE: "legacy_zdse",
  LEGACY_PRIVATE_KEY_BACKUP_V1: "legacy_private_key_backup_v1",
} as const;

export type ZeroDriveEncryptedFormat =
  (typeof ZERO_DRIVE_FORMATS)[keyof typeof ZERO_DRIVE_FORMATS];
