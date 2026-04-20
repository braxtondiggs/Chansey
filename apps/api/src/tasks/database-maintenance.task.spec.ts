import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';

import { DatabaseMaintenanceTask } from './database-maintenance.task';

describe('DatabaseMaintenanceTask', () => {
  let task: DatabaseMaintenanceTask;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DatabaseMaintenanceTask, { provide: getDataSourceToken(), useValue: dataSource }]
    }).compile();

    task = module.get(DatabaseMaintenanceTask);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('runs ANALYZE on every hot table', async () => {
    await task.runMaintenance();

    const tables = (dataSource.query.mock.calls as [string][]).map(([sql]) => sql);
    expect(tables).toContain('ANALYZE "ohlc_candles"');
    expect(tables).toContain('ANALYZE "backtest_signals"');
    expect(tables).toContain('ANALYZE "backtest_trades"');
    expect(tables).toContain('ANALYZE "pipelines"');
    expect(tables).toContain('ANALYZE "strategy_configs"');
  });

  it('continues when a single table fails', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('ohlc_candles')) throw new Error('permission denied');
      return [];
    });

    await expect(task.runMaintenance()).resolves.toBeUndefined();

    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('backtest_signals'));
    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('ohlc_candles'));
  });

  it('skips when already running', async () => {
    let resolveFirst: () => void = () => undefined;
    const firstCall = new Promise<void>((resolve) => (resolveFirst = resolve));
    dataSource.query.mockImplementation(() => firstCall.then(() => []));

    const first = task.runMaintenance();
    const second = task.runMaintenance();

    resolveFirst();
    await Promise.all([first, second]);

    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('already running'));
  });
});
