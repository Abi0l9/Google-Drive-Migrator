import { Schema, model, models } from "mongoose";

const MigrationItemSchema = new Schema(
  {
    migrationId: { type: Schema.Types.ObjectId, ref: "Migration", required: true, index: true },
    sourceFileId: { type: String, required: true },
    sourceName: { type: String, required: true },
    sourceMimeType: { type: String, required: true },
    sourcePath: { type: String, required: true },
    destinationFileId: String,
    destinationFolderId: String,
    itemType: { type: String, enum: ["file", "folder"], required: true },
    size: { type: Number, default: 0 },
    uploadedBytes: { type: Number, default: 0 },
    encryptedUploadSessionUrl: String,
    transferJobId: String,
    transferLeaseUntil: Date,
    status: { type: String, enum: ["pending", "copying", "completed", "failed", "skipped"], default: "pending" },
    retryCount: { type: Number, default: 0 },
    errorMessage: String,
  },
  { timestamps: true },
);

MigrationItemSchema.index({ migrationId: 1, sourceFileId: 1 }, { unique: true });
MigrationItemSchema.index({ status: 1, transferLeaseUntil: 1 });

export const MigrationItem = models.MigrationItem ?? model("MigrationItem", MigrationItemSchema);
