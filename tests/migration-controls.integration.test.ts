import assert from "node:assert/strict";
import test from "node:test";
import IORedis from "ioredis";
import mongoose from "mongoose";

const integrationEnabled = process.env.GDM_INTEGRATION_TESTS === "1";

test("migration controls preserve ownership, lifecycle, queues, and Google reconnect safety", {
  skip: !integrationEnabled,
  timeout: 25_000,
}, async () => {
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/drive-migrator-controls-ci";
  process.env.REDIS_URL = "redis://127.0.0.1:6379/5";
  process.env.TOKEN_ENCRYPTION_KEY = "ci-controls-token-encryption-key";

  const [
    { connectDb },
    { encryptToken },
    { isGoogleReauthorizationRequiredError },
    controls,
    queues,
    { Migration },
    { MigrationItem },
    { User },
  ] = await Promise.all([
    import("../lib/db"),
    import("../lib/crypto"),
    import("../lib/google/auth-errors"),
    import("../lib/migration/controls"),
    import("../lib/queue/migrations"),
    import("../models/migration"),
    import("../models/migration-item"),
    import("../models/user"),
  ]);

  const redisUrl = process.env.REDIS_URL;
  assert(redisUrl);
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  try {
    await redis.flushdb();
    await connectDb();
    await mongoose.connection.db?.dropDatabase();

    const accessToken = encryptToken("controls-access-token");
    const refreshToken = encryptToken("controls-refresh-token");
    assert(accessToken && refreshToken);

    const user = await User.create({
      name: "Controls User",
      email: "controls@example.com",
      googleId: "controls-google-id",
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const otherUser = await User.create({
      name: "Other User",
      email: "other-controls@example.com",
      googleId: "other-controls-google-id",
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const migration = await Migration.create({
      userId: user._id,
      sourceFolderId: "controls-source",
      sourceFolderUrl: "https://drive.google.com/drive/folders/controls-source",
      sourceFolderName: "Controls Source",
      destinationFolderId: "controls-destination",
      destinationFolderName: "Controls Destination",
      status: "pending",
    });
    const pendingItem = await MigrationItem.create({
      migrationId: migration._id,
      sourceFileId: "pending-file",
      sourceName: "pending.txt",
      sourceMimeType: "text/plain",
      sourcePath: "Controls Source/pending.txt",
      destinationFolderId: "controls-destination",
      itemType: "file",
      status: "pending",
      size: 10,
    });

    const foreignPause = await controls.pauseMigrationForUser(otherUser._id.toString(), migration._id.toString());
    assert.equal(foreignPause.outcome, "not_found");

    const invalidPause = await controls.pauseMigrationForUser(user._id.toString(), "not-a-migration-id");
    assert.equal(invalidPause.outcome, "not_found");

    const paused = await controls.pauseMigrationForUser(user._id.toString(), migration._id.toString());
    assert.deepEqual(paused, { outcome: "ok", status: "paused" });
    assert.equal((await Migration.findById(migration._id).lean())?.status, "paused");

    const resumed = await controls.resumeMigrationForUser(user._id.toString(), migration._id.toString());
    assert.equal(resumed.outcome, "ok");
    if (resumed.outcome !== "ok") throw new Error("Expected resume to succeed");
    assert.equal(resumed.status, "pending");
    assert.equal(resumed.scanCompleted, false);

    const scanCounts = await queues.getScanQueue().getJobCounts("waiting", "delayed");
    assert.ok((scanCounts.waiting ?? 0) + (scanCounts.delayed ?? 0) >= 1);

    const cancelled = await controls.cancelMigrationForUser(user._id.toString(), migration._id.toString());
    assert.deepEqual(cancelled, { outcome: "ok", status: "cancelled" });
    const cancelledMigration = await Migration.findById(migration._id).lean();
    const skippedItem = await MigrationItem.findById(pendingItem._id).lean();
    assert.equal(cancelledMigration?.status, "cancelled");
    assert.ok(cancelledMigration?.completedAt);
    assert.equal(skippedItem?.status, "skipped");
    assert.equal(skippedItem?.errorMessage, "Migration cancelled");

    const retryMigration = await Migration.create({
      userId: user._id,
      sourceFolderId: "retry-source",
      sourceFolderUrl: "https://drive.google.com/drive/folders/retry-source",
      sourceFolderName: "Retry Source",
      destinationFolderId: "retry-destination",
      destinationFolderName: "Retry Destination",
      status: "failed",
      scanCompleted: true,
      failedFiles: 1,
      completedAt: new Date(),
    });
    const failedItem = await MigrationItem.create({
      migrationId: retryMigration._id,
      sourceFileId: "failed-file",
      sourceName: "failed.txt",
      sourceMimeType: "text/plain",
      sourcePath: "Retry Source/failed.txt",
      destinationFolderId: "retry-destination",
      itemType: "file",
      status: "failed",
      retryCount: 3,
      errorMessage: "Temporary Drive error",
      size: 20,
    });

    const retried = await controls.retryMigrationForUser(user._id.toString(), retryMigration._id.toString());
    assert.equal(retried.outcome, "ok");
    if (retried.outcome !== "ok") throw new Error("Expected retry to succeed");
    assert.equal(retried.retried, 1);
    assert.equal(retried.status, "running");

    const retriedMigration = await Migration.findById(retryMigration._id).lean();
    const retriedItem = await MigrationItem.findById(failedItem._id).lean();
    assert.equal(retriedMigration?.status, "running");
    assert.equal(retriedItem?.status, "pending");
    assert.equal(retriedItem?.retryCount, 0);
    assert.equal(retriedItem?.errorMessage, undefined);

    const transferCounts = await queues.getTransferQueue().getJobCounts("waiting", "delayed");
    const reportCounts = await queues.getReportQueue().getJobCounts("waiting", "delayed");
    assert.ok((transferCounts.waiting ?? 0) + (transferCounts.delayed ?? 0) >= 1);
    assert.ok((reportCounts.waiting ?? 0) + (reportCounts.delayed ?? 0) >= 1);

    const reconnectMigration = await Migration.create({
      userId: user._id,
      sourceFolderId: "reconnect-source",
      sourceFolderUrl: "https://drive.google.com/drive/folders/reconnect-source",
      sourceFolderName: "Reconnect Source",
      destinationFolderId: "reconnect-destination",
      destinationFolderName: "Reconnect Destination",
      status: "failed",
      scanCompleted: true,
      failedFiles: 1,
      completedAt: new Date(),
    });
    const reconnectItem = await MigrationItem.create({
      migrationId: reconnectMigration._id,
      sourceFileId: "reconnect-failed-file",
      sourceName: "reconnect.txt",
      sourceMimeType: "text/plain",
      sourcePath: "Reconnect Source/reconnect.txt",
      destinationFolderId: "reconnect-destination",
      itemType: "file",
      status: "failed",
      retryCount: 2,
      errorMessage: "Google Drive access needs to be reconnected",
      size: 30,
    });

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          accessToken: "",
          refreshToken: "",
          accessTokenExpiresAt: new Date(0),
        },
      },
    );

    await assert.rejects(
      () => controls.retryMigrationForUser(user._id.toString(), reconnectMigration._id.toString()),
      (error: unknown) => isGoogleReauthorizationRequiredError(error),
    );

    const reconnectAfter = await Migration.findById(reconnectMigration._id).lean();
    const reconnectItemAfter = await MigrationItem.findById(reconnectItem._id).lean();
    assert.equal(reconnectAfter?.status, "failed");
    assert.ok(reconnectAfter?.completedAt);
    assert.equal(reconnectItemAfter?.status, "failed");
    assert.equal(reconnectItemAfter?.retryCount, 2);
    assert.equal(reconnectItemAfter?.errorMessage, "Google Drive access needs to be reconnected");
  } finally {
    await queues.closeMigrationQueueResources();
    await mongoose.connection.db?.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
    await redis.flushdb().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
});
