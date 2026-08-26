import { Schema, model, models } from "mongoose";

const MigrationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sourceFolderId: { type: String, required: true },
    sourceFolderUrl: { type: String, required: true },
    sourceFolderName: { type: String, required: true },
    destinationFolderId: { type: String, required: true },
    destinationFolderName: { type: String, required: true },
    destinationRootFolderId: String,
    status: { type: String, enum: ["pending", "scanning", "running", "paused", "completed", "failed", "cancelled"], default: "pending" },
    scanCompleted: { type: Boolean, default: false },
    totalFiles: { type: Number, default: 0 },
    completedFiles: { type: Number, default: 0 },
    failedFiles: { type: Number, default: 0 },
    totalBytes: { type: Number, default: 0 },
    copiedBytes: { type: Number, default: 0 },
    errorMessage: String,
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true },
);

export const Migration = models.Migration ?? model("Migration", MigrationSchema);
