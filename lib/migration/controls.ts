import { isValidObjectId } from "mongoose";
import { getFreshGoogleAccessToken } from "@/lib/google/user-auth";
import {
  getReportQueue,
  getRetryQueue,
  getScanQueue,
  getTransferQueue,
} from "@/lib/queue/migrations";
import { Migration } from "@/models/migration";
import { MigrationItem } from "@/models/migration-item";
import { User } from "@/models/user";

const pausableStatuses = new Set(["pending", "scanning", "running"]);
const alreadyActiveStatuses = new Set(["pending", "scanning", "running"]);
const cancellableStatuses = new Set(["pending", "scanning", "running", "paused"]);

export type MigrationControlResult =
  | { outcome: "ok"; status: string; scanCompleted?: boolean; retried?: number }
  | { outcome: "not_found" }
  | { outcome: "conflict"; status: string }
  | { outcome: "queue_unavailable"; status: string; message: string };

export async function pauseMigrationForUser(userId: string, migrationId: string): Promise<MigrationControlResult> {
  const migration = await findOwnedMigration(userId, migrationId);
  if (!migration) return { outcome: "not_found" };

  if (migration.status === "paused") {
    return { outcome: "ok", status: migration.status };
  }

  if (!pausableStatuses.has(migration.status)) {
    return { outcome: "conflict", status: migration.status };
  }

  migration.status = "paused";
  migration.completedAt = undefined;
  migration.errorMessage = undefined;
  await migration.save();

  return { outcome: "ok", status: migration.status };
}

export async function resumeMigrationForUser(userId: string, migrationId: string): Promise<MigrationControlResult> {
  const migration = await findOwnedMigration(userId, migrationId);
  if (!migration) return { outcome: "not_found" };

  if (alreadyActiveStatuses.has(migration.status)) {
    return { outcome: "ok", status: migration.status, scanCompleted: Boolean(migration.scanCompleted) };
  }

  if (migration.status !== "paused") {
    return { outcome: "conflict", status: migration.status };
  }

  const scanCompleted = Boolean(migration.scanCompleted);
  migration.status = scanCompleted ? "running" : "pending";
  migration.completedAt = undefined;
  migration.errorMessage = undefined;
  await migration.save();

  try {
    if (scanCompleted) {
      await getRetryQueue().add(
        "resume-migration",
        { migrationId: migration._id.toString() },
        { delay: 1500 },
      );
    } else {
      await getScanQueue().add("resume-scan", { migrationId: migration._id.toString() });
    }
  } catch (error) {
    migration.status = "paused";
    migration.errorMessage = error instanceof Error ? error.message : "Migration queue unavailable";
    await migration.save();
    return {
      outcome: "queue_unavailable",
      status: migration.status,
      message: migration.errorMessage,
    };
  }

  return { outcome: "ok", status: migration.status, scanCompleted };
}

export async function cancelMigrationForUser(userId: string, migrationId: string): Promise<MigrationControlResult> {
  const migration = await findOwnedMigration(userId, migrationId);
  if (!migration) return { outcome: "not_found" };

  if (migration.status === "cancelled") {
    return { outcome: "ok", status: migration.status };
  }

  if (!cancellableStatuses.has(migration.status)) {
    return { outcome: "conflict", status: migration.status };
  }

  migration.status = "cancelled";
  migration.completedAt = new Date();
  migration.errorMessage = undefined;
  await migration.save();

  await MigrationItem.updateMany(
    { migrationId: migration._id, itemType: "file", status: "pending" },
    { $set: { status: "skipped", errorMessage: "Migration cancelled" } },
  );

  return { outcome: "ok", status: migration.status };
}

export async function retryMigrationForUser(userId: string, migrationId: string): Promise<MigrationControlResult> {
  const migration = await findOwnedMigration(userId, migrationId);
  if (!migration) return { outcome: "not_found" };

  const failedItems = await MigrationItem.find({
    migrationId: migration._id,
    itemType: "file",
    status: "failed",
  }).select("_id");

  if (!failedItems.length) {
    return { outcome: "ok", retried: 0, status: migration.status };
  }

  if (migration.status !== "failed") {
    return { outcome: "conflict", status: migration.status };
  }

  const user = await User.findById(userId);
  if (!user) return { outcome: "not_found" };

  // Validate Google authorization before mutating failed items. If the user's
  // refresh token was revoked or removed, getFreshGoogleAccessToken throws the
  // explicit reauthorization error used by the HTTP route and UI.
  await getFreshGoogleAccessToken(user);

  const failedIds = failedItems.map((item) => item._id);

  await MigrationItem.updateMany(
    { _id: { $in: failedIds } },
    { $set: { status: "pending", retryCount: 0 }, $unset: { errorMessage: "" } },
  );

  migration.status = "running";
  migration.completedAt = undefined;
  migration.errorMessage = undefined;
  await migration.save();

  try {
    await getTransferQueue().addBulk(
      failedItems.map((item) => ({
        name: "retry-transfer-file",
        data: { migrationId: migration._id.toString(), itemId: item._id.toString() },
      })),
    );
    await getReportQueue().add("refresh-report", { migrationId: migration._id.toString() });
  } catch (error) {
    await MigrationItem.updateMany(
      { _id: { $in: failedIds }, status: "pending" },
      { $set: { status: "failed", errorMessage: "Retry queue unavailable" } },
    );
    migration.status = "failed";
    migration.errorMessage = error instanceof Error ? error.message : "Retry queue unavailable";
    migration.completedAt = new Date();
    await migration.save();

    return {
      outcome: "queue_unavailable",
      status: migration.status,
      message: migration.errorMessage,
    };
  }

  return { outcome: "ok", retried: failedItems.length, status: migration.status };
}

function findOwnedMigration(userId: string, migrationId: string) {
  if (!isValidObjectId(userId) || !isValidObjectId(migrationId)) return null;
  return Migration.findOne({ _id: migrationId, userId });
}
