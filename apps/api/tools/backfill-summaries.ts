/* eslint-disable no-console */
/**
 * Throwaway backfill for analytics summary tables introduced in issue #419.
 *
 * Usage:
 *   ts-node apps/api/tools/backfill-summaries.ts
 *
 * Iterates all COMPLETED backtests, optimization runs, and paper-trading sessions,
 * calling each summary service's `computeAndPersist`. Progress logged every 50 items.
 * Upsert on UNIQUE parent FK means reruns are safe.
 *
 * DELETE THIS FILE AFTER SUCCESSFUL PROD BACKFILL.
 */

import { NestFactory } from '@nestjs/core';

import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { OptimizationRun, OptimizationStatus } from '../src/optimization/entities/optimization-run.entity';
import { OptimizationRunSummaryService } from '../src/optimization/services/optimization-run-summary.service';
import { BacktestSummaryService } from '../src/order/backtest/backtest-summary.service';
import { Backtest, BacktestStatus } from '../src/order/backtest/backtest.entity';
import {
  PaperTradingSession,
  PaperTradingStatus
} from '../src/order/paper-trading/entities/paper-trading-session.entity';
import { PaperTradingSessionSummaryService } from '../src/order/paper-trading/paper-trading-session-summary.service';

const PROGRESS_EVERY = 50;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const dataSource = app.get(DataSource);

  try {
    await backfillBacktests(app);
    await backfillOptimizationRuns(app);
    await backfillPaperTradingSessions(app);

    console.log('\nRunning ANALYZE on summary tables...');
    await dataSource.query('ANALYZE backtest_summaries');
    await dataSource.query('ANALYZE optimization_run_summaries');
    await dataSource.query('ANALYZE paper_trading_session_summaries');
    console.log('Done.');
  } finally {
    await app.close();
  }
}

async function backfillBacktests(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>) {
  const svc = app.get(BacktestSummaryService);
  const repo = app.get(DataSource).getRepository(Backtest);
  const rows = await repo.find({
    where: { status: BacktestStatus.COMPLETED },
    select: ['id'] as (keyof Backtest)[]
  });
  console.log(`Backtests: ${rows.length} to process`);
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await svc.computeAndPersist(row.id);
    } catch (err) {
      failed += 1;
      console.error(`  FAIL ${row.id}:`, (err as Error).message);
    }
    processed += 1;
    if (processed % PROGRESS_EVERY === 0) {
      console.log(`  ${processed}/${rows.length} (failed: ${failed})`);
    }
  }
  console.log(`Backtests done: ${processed} processed, ${failed} failed`);
}

async function backfillOptimizationRuns(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>) {
  const svc = app.get(OptimizationRunSummaryService);
  const repo = app.get(DataSource).getRepository(OptimizationRun);
  const rows = await repo.find({
    where: { status: OptimizationStatus.COMPLETED },
    select: ['id'] as (keyof OptimizationRun)[]
  });
  console.log(`\nOptimization runs: ${rows.length} to process`);
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await svc.computeAndPersist(row.id);
    } catch (err) {
      failed += 1;
      console.error(`  FAIL ${row.id}:`, (err as Error).message);
    }
    processed += 1;
    if (processed % PROGRESS_EVERY === 0) {
      console.log(`  ${processed}/${rows.length} (failed: ${failed})`);
    }
  }
  console.log(`Optimization runs done: ${processed} processed, ${failed} failed`);
}

async function backfillPaperTradingSessions(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>) {
  const svc = app.get(PaperTradingSessionSummaryService);
  const repo = app.get(DataSource).getRepository(PaperTradingSession);
  const rows = await repo.find({
    where: { status: PaperTradingStatus.COMPLETED },
    select: ['id'] as (keyof PaperTradingSession)[]
  });
  console.log(`\nPaper trading sessions: ${rows.length} to process`);
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await svc.computeAndPersist(row.id);
    } catch (err) {
      failed += 1;
      console.error(`  FAIL ${row.id}:`, (err as Error).message);
    }
    processed += 1;
    if (processed % PROGRESS_EVERY === 0) {
      console.log(`  ${processed}/${rows.length} (failed: ${failed})`);
    }
  }
  console.log(`Paper trading sessions done: ${processed} processed, ${failed} failed`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
