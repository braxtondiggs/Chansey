#!/usr/bin/env node

/**
 * One-time Redis cleanup script for BullMQ db3.
 *
 * Aggressively trims completed/failed job sets, deletes orphaned job hashes,
 * and trims event + telemetry streams.
 *
 * Usage (local):
 *   npm run redis:cleanup                                # dry-run (default)
 *   npm run redis:cleanup -- --execute                   # actually delete
 *   npm run redis:cleanup -- --execute --keep=50         # keep last 50 per set
 *
 * Usage (Railway production):
 *   railway run npm run redis:cleanup                    # dry-run
 *   railway run npm run redis:cleanup -- --execute       # actually delete
 *
 * Environment variables (auto-injected by `railway run`):
 *   REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_USER, REDIS_TLS
 *
 * Safety:
 *   - Only touches completed/failed sets, never active/waiting/delayed/paused/prioritized
 *   - Uses SCAN (never KEYS) to avoid blocking Redis
 *   - Pipeline batching to avoid memory spikes
 *
 * After cleanup reduces usage below 1GB, apply maxmemory config:
 *   CONFIG SET maxmemory 1073741824
 *   CONFIG SET maxmemory-policy volatile-lru
 *   CONFIG REWRITE
 */

const Redis = require('ioredis');

// IMPORTANT: Keep in sync with apps/api/src/shutdown/queue-names.constant.ts
const QUEUE_NAMES = [
  'balance-queue',
  'backtest-historical',
  'backtest-orchestration',
  'backtest-replay',
  'category-queue',
  'coin-queue',
  'drift-detection-queue',
  'exchange-queue',
  'notification',
  'optimization',
  'order-queue',
  'paper-trading',
  'performance-ranking',
  'pipeline',
  'pipeline-orchestration',
  'coin-selection-queue',
  'price-queue',
  'regime-check-queue',
  'strategy-evaluation-queue',
  'ticker-pairs-queue',
  'trade-execution',
  'user-queue'
];

const TELEMETRY_STREAMS = ['backtest-telemetry', 'paper-trading-telemetry'];
const BATCH_SIZE = 500;

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    execute: args.includes('--execute'),
    keep: parseInt((args.find((a) => a.startsWith('--keep=')) || '--keep=50').split('=')[1], 10),
    keepFailed: parseInt((args.find((a) => a.startsWith('--keep-failed=')) || '--keep-failed=25').split('=')[1], 10)
  };
}

function createConnection(db) {
  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD || undefined;
  const username = process.env.REDIS_USER || undefined;
  const tls = process.env.REDIS_TLS === 'true';

  return new Redis({
    host,
    port,
    username,
    password,
    family: 0,
    db,
    tls: tls ? {} : undefined,
    maxRetriesPerRequest: 3
  });
}

async function getKeyCount(redis) {
  const info = await redis.info('keyspace');
  const match = info.match(/db3:keys=(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

async function getMemoryUsage(redis) {
  const info = await redis.info('memory');
  const match = info.match(/used_memory:(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

async function trimSortedSet(redis, key, keep, execute) {
  const total = await redis.zcard(key);
  if (total <= keep) return { removed: 0, jobIds: [] };

  const removeCount = total - keep;
  const jobIds = await redis.zrange(key, 0, removeCount - 1);

  if (execute && jobIds.length > 0) {
    await redis.zremrangebyrank(key, 0, removeCount - 1);
  }

  return { removed: jobIds.length, jobIds };
}

async function deleteJobHashes(redis, queuePrefix, jobIds, execute) {
  if (!execute || jobIds.length === 0) return 0;

  let deleted = 0;
  for (let i = 0; i < jobIds.length; i += BATCH_SIZE) {
    const batch = jobIds.slice(i, i + BATCH_SIZE);
    const pipeline = redis.pipeline();
    for (const id of batch) {
      pipeline.del(`${queuePrefix}:${id}`);
      pipeline.del(`${queuePrefix}:${id}:logs`);
    }
    const results = await pipeline.exec();
    if (results) {
      deleted += results.filter(([err, val]) => !err && val === 1).length;
    }
  }
  return deleted;
}

async function cleanOrphanedKeys(redis, execute) {
  console.log('\n--- Scanning for orphaned job keys ---');
  const knownPrefixes = QUEUE_NAMES.map((q) => `bull:${q}:`);
  let orphanCount = 0;
  let deleted = 0;
  let scanned = 0;

  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'bull:*', 'COUNT', 500);
    cursor = nextCursor;
    scanned += keys.length;

    const jobHashKeys = keys.filter((k) => {
      const matchedPrefix = knownPrefixes.find((p) => k.startsWith(p));
      if (!matchedPrefix) return false;
      const suffix = k.slice(matchedPrefix.length);
      return /^\d+$/.test(suffix);
    });

    // Batch state checks via pipeline
    const jobMeta = jobHashKeys.map((jobKey) => {
      const parts = jobKey.split(':');
      const jobId = parts[parts.length - 1];
      const queuePrefix = parts.slice(0, -1).join(':');
      return { jobKey, jobId, queuePrefix };
    });

    const checkPipeline = redis.pipeline();
    for (const { jobId, queuePrefix } of jobMeta) {
      checkPipeline.lpos(`${queuePrefix}:active`, jobId);
      checkPipeline.lpos(`${queuePrefix}:wait`, jobId);
      checkPipeline.zscore(`${queuePrefix}:delayed`, jobId);
      checkPipeline.zscore(`${queuePrefix}:completed`, jobId);
      checkPipeline.zscore(`${queuePrefix}:failed`, jobId);
      checkPipeline.lpos(`${queuePrefix}:paused`, jobId);
      checkPipeline.zscore(`${queuePrefix}:prioritized`, jobId);
    }
    const checkResults = await checkPipeline.exec();

    const orphanKeys = [];
    if (checkResults) {
      for (let j = 0; j < jobMeta.length; j++) {
        const base = j * 7;
        const allNull =
          checkResults[base][1] === null &&
          checkResults[base + 1][1] === null &&
          checkResults[base + 2][1] === null &&
          checkResults[base + 3][1] === null &&
          checkResults[base + 4][1] === null &&
          checkResults[base + 5][1] === null &&
          checkResults[base + 6][1] === null;
        if (allNull) {
          orphanCount++;
          orphanKeys.push(jobMeta[j].jobKey);
        }
      }
    }

    if (execute && orphanKeys.length > 0) {
      const delPipeline = redis.pipeline();
      for (const jobKey of orphanKeys) {
        delPipeline.del(jobKey);
        delPipeline.del(`${jobKey}:logs`);
      }
      const delResults = await delPipeline.exec();
      if (delResults) {
        deleted += delResults.filter(([err, val]) => !err && val === 1).length;
      }
    }

    // Progress indicator
    if (scanned % 5000 === 0) {
      process.stdout.write(`  Scanned ${scanned} keys...\r`);
    }
  } while (cursor !== '0');

  console.log(`  Scanned ${scanned} total keys`);
  console.log(`  Found ${orphanCount} orphaned job keys`);
  if (execute) {
    console.log(`  Deleted ${deleted} orphaned keys`);
  }

  return { orphanCount, deleted };
}

async function trimEventStreams(redis, execute) {
  let trimmed = 0;
  for (const queueName of QUEUE_NAMES) {
    const streamKey = `bull:${queueName}:events`;
    try {
      const exists = await redis.exists(streamKey);
      if (!exists) continue;

      const len = await redis.xlen(streamKey);
      if (len > 500) {
        if (execute) {
          await redis.xtrim(streamKey, 'MAXLEN', '~', 500);
          const newLen = await redis.xlen(streamKey);
          trimmed += len - newLen;
        } else {
          trimmed += Math.max(0, len - 500);
        }
      }
    } catch {
      // Stream may not exist or be a different type
    }
  }
  return trimmed;
}

async function trimTelemetryStreams(db0, execute) {
  let trimmed = 0;
  for (const stream of TELEMETRY_STREAMS) {
    try {
      const exists = await db0.exists(stream);
      if (!exists) continue;

      const len = await db0.xlen(stream);
      if (len > 2000) {
        if (execute) {
          await db0.xtrim(stream, 'MAXLEN', '~', 2000);
          const newLen = await db0.xlen(stream);
          trimmed += len - newLen;
        } else {
          trimmed += Math.max(0, len - 2000);
        }
      }
      console.log(`  ${stream}: ${len} entries${len > 2000 ? ` (would trim to ~2000)` : ' (ok)'}`);
    } catch {
      // Stream may not exist
    }
  }
  return trimmed;
}

async function main() {
  const { execute, keep, keepFailed } = parseArgs();

  console.log('=== Redis BullMQ Cleanup ===');
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`Keep completed: ${keep} per queue`);
  console.log(`Keep failed: ${keepFailed} per queue`);
  console.log('');

  const redis = createConnection(3);
  const db0 = createConnection(0);

  try {
    // Check connectivity
    await redis.ping();
    console.log('Connected to Redis db3 (BullMQ)');

    const keysBefore = await getKeyCount(redis);
    const memBefore = await getMemoryUsage(redis);
    console.log(`Keys before: ${keysBefore.toLocaleString()}`);
    console.log(`Memory before: ${(memBefore / 1024 / 1024).toFixed(1)} MB`);
    console.log('');

    let totalRemoved = 0;
    let totalJobHashesDeleted = 0;

    // Process each queue
    for (const queueName of QUEUE_NAMES) {
      const prefix = `bull:${queueName}`;

      const completedResult = await trimSortedSet(redis, `${prefix}:completed`, keep, execute);
      const failedResult = await trimSortedSet(redis, `${prefix}:failed`, keepFailed, execute);

      const queueTotal = completedResult.removed + failedResult.removed;
      if (queueTotal > 0) {
        console.log(`${queueName}: completed -${completedResult.removed}, failed -${failedResult.removed}`);

        // Delete job hashes for removed entries
        const allRemovedIds = [...completedResult.jobIds, ...failedResult.jobIds];
        const hashesDeleted = await deleteJobHashes(redis, prefix, allRemovedIds, execute);
        totalJobHashesDeleted += hashesDeleted;
      }

      totalRemoved += queueTotal;
    }

    console.log(`\nQueue trimming: ${totalRemoved} set entries removed`);
    if (execute) {
      console.log(`Job hashes deleted: ${totalJobHashesDeleted}`);
    }

    // Trim event streams
    console.log('\n--- Trimming event streams ---');
    const eventsTrimmed = await trimEventStreams(redis, execute);
    console.log(`Event stream entries trimmed: ${eventsTrimmed}`);

    // Clean orphaned keys
    const orphanResult = await cleanOrphanedKeys(redis, execute);

    // Trim telemetry streams on db0
    console.log('\n--- Telemetry streams (db0) ---');
    try {
      await db0.ping();
      const telemetryTrimmed = await trimTelemetryStreams(db0, execute);
      console.log(`Telemetry entries trimmed: ${telemetryTrimmed}`);
    } catch (err) {
      console.log(`  Could not connect to db0: ${err.message}`);
    }

    // Summary
    console.log('\n=== Summary ===');
    if (execute) {
      const keysAfter = await getKeyCount(redis);
      const memAfter = await getMemoryUsage(redis);
      console.log(
        `Keys: ${keysBefore.toLocaleString()} -> ${keysAfter.toLocaleString()} (-${(keysBefore - keysAfter).toLocaleString()})`
      );
      console.log(
        `Memory: ${(memBefore / 1024 / 1024).toFixed(1)} MB -> ${(memAfter / 1024 / 1024).toFixed(1)} MB (-${((memBefore - memAfter) / 1024 / 1024).toFixed(1)} MB)`
      );
    } else {
      const estimatedRemoval = totalRemoved * 2 + orphanResult.orphanCount * 2 + eventsTrimmed;
      console.log(`Estimated keys to remove: ~${estimatedRemoval.toLocaleString()}`);
      console.log(`  Set entries: ${totalRemoved.toLocaleString()}`);
      console.log(`  Job hashes + logs: ~${(totalRemoved * 2).toLocaleString()}`);
      console.log(`  Orphaned keys: ~${(orphanResult.orphanCount * 2).toLocaleString()}`);
      console.log(`  Event stream entries: ${eventsTrimmed.toLocaleString()}`);
      console.log('\nRun with --execute to apply changes');
    }

    console.log('\nPost-cleanup: Apply maxmemory config after usage drops below 1GB:');
    console.log('  CONFIG SET maxmemory 1073741824');
    console.log('  CONFIG SET maxmemory-policy volatile-lru');
    console.log('  CONFIG REWRITE');
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  } finally {
    redis.disconnect();
    db0.disconnect();
  }
}

main();
