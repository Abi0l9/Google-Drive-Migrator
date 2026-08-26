export interface TransferProgressInput {
  status?: string;
  copiedBytes?: number;
  currentFileUploadedBytes?: number;
  totalBytes?: number;
}

export interface TransferSample {
  at: number;
  bytes: number;
  lastMovementAt: number;
  rateBytesPerSecond?: number;
}

export interface TransferMetrics {
  sample: TransferSample;
  rateBytesPerSecond?: number;
  etaSeconds?: number;
}

const STALL_AFTER_MS = 10_000;
const RATE_SMOOTHING_FACTOR = 0.3;

export function transferredBytes(input: TransferProgressInput) {
  return Math.max(0, (input.copiedBytes ?? 0) + (input.currentFileUploadedBytes ?? 0));
}

export function updateTransferMetrics(
  previous: TransferSample | undefined,
  input: TransferProgressInput,
  now = Date.now(),
): TransferMetrics {
  const bytes = transferredBytes(input);
  const totalBytes = Math.max(0, input.totalBytes ?? 0);

  if (input.status !== "running") {
    return {
      sample: {
        at: now,
        bytes,
        lastMovementAt: previous?.lastMovementAt ?? now,
      },
    };
  }

  if (!previous) {
    return {
      sample: {
        at: now,
        bytes,
        lastMovementAt: now,
      },
    };
  }

  const elapsedSeconds = Math.max(0, (now - previous.at) / 1000);
  const deltaBytes = bytes - previous.bytes;
  let rateBytesPerSecond = previous.rateBytesPerSecond;
  let lastMovementAt = previous.lastMovementAt;

  if (deltaBytes > 0 && elapsedSeconds > 0) {
    const instantaneousRate = deltaBytes / elapsedSeconds;
    rateBytesPerSecond = rateBytesPerSecond
      ? rateBytesPerSecond * (1 - RATE_SMOOTHING_FACTOR) + instantaneousRate * RATE_SMOOTHING_FACTOR
      : instantaneousRate;
    lastMovementAt = now;
  } else if (deltaBytes < 0 || now - lastMovementAt >= STALL_AFTER_MS) {
    rateBytesPerSecond = undefined;
    if (deltaBytes < 0) lastMovementAt = now;
  }

  const remainingBytes = Math.max(0, totalBytes - bytes);
  const etaSeconds = rateBytesPerSecond && rateBytesPerSecond > 0
    ? remainingBytes / rateBytesPerSecond
    : undefined;

  return {
    sample: {
      at: now,
      bytes,
      lastMovementAt,
      rateBytesPerSecond,
    },
    rateBytesPerSecond,
    etaSeconds,
  };
}
