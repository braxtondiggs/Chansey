import type { DataSource } from 'typeorm';

import { DataRetentionTask } from './data-retention.task';

describe('DataRetentionTask', () => {
  const originalEnv = process.env;
  let task: DataRetentionTask;
  let dataSource: { query: jest.Mock };

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'production', DISABLE_BACKGROUND_TASKS: 'false' };

    dataSource = { query: jest.fn().mockResolvedValue([]) };
    task = new DataRetentionTask(dataSource as unknown as DataSource);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('skips sweep when DISABLE_BACKGROUND_TASKS is true', async () => {
    process.env.DISABLE_BACKGROUND_TASKS = 'true';

    await task.run();

    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('skips sweep in development', async () => {
    process.env.NODE_ENV = 'development';

    await task.run();

    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('runs every retention rule once and counts deleted rows', async () => {
    dataSource.query.mockImplementation(() => Promise.resolve([{ deleted: 2 }]));

    await task.run();

    // 21 retention rules currently declared — each issues one DELETE
    expect(dataSource.query).toHaveBeenCalledTimes(21);
  });

  it('continues the sweep when a single rule throws', async () => {
    dataSource.query.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([{ deleted: 0 }]);

    await expect(task.run()).resolves.toBeUndefined();

    // First call failed, the remaining 20 still executed
    expect(dataSource.query).toHaveBeenCalledTimes(21);
  });

  it('passes retention days as a string param and uses defaults when env is unset', async () => {
    delete process.env.DATA_RETENTION_EXCHANGE_KEY_HEALTH_LOG_DAYS;
    dataSource.query.mockResolvedValue([{ deleted: 0 }]);

    await task.run();

    const firstCall = dataSource.query.mock.calls[0];
    expect(firstCall[0]).toMatch(/exchange_key_health_log/);
    expect(firstCall[1]).toEqual(['30']);
  });

  it('respects env-override retention days', async () => {
    process.env.DATA_RETENTION_EXCHANGE_KEY_HEALTH_LOG_DAYS = '7';
    dataSource.query.mockResolvedValue([{ deleted: 0 }]);

    await task.run();

    const firstCall = dataSource.query.mock.calls[0];
    expect(firstCall[1]).toEqual(['7']);
  });

  it.each(['0', '-5', '1.5', 'abc'])('ignores invalid env override "%s" and falls back to defaults', async (value) => {
    process.env.DATA_RETENTION_EXCHANGE_KEY_HEALTH_LOG_DAYS = value;
    dataSource.query.mockResolvedValue([{ deleted: 0 }]);

    await task.run();

    const firstCall = dataSource.query.mock.calls[0];
    expect(firstCall[1]).toEqual(['30']);
  });

  it('issues separate retention deletes for read and unread notifications', async () => {
    process.env.DATA_RETENTION_NOTIFICATION_READ_DAYS = '15';
    process.env.DATA_RETENTION_NOTIFICATION_UNREAD_DAYS = '90';
    dataSource.query.mockResolvedValue([{ deleted: 0 }]);

    await task.run();

    const readCall = dataSource.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('"notification"') && sql.includes('read = true')
    );
    expect(readCall).toBeDefined();
    expect(readCall?.[1]).toEqual(['15']);

    const unreadCall = dataSource.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('"notification"') && sql.includes('read = false')
    );
    expect(unreadCall).toBeDefined();
    expect(unreadCall?.[1]).toEqual(['90']);
  });

  it('does not re-enter while a sweep is still running', async () => {
    let resolveFirst!: (v: unknown[]) => void;
    dataSource.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    dataSource.query.mockResolvedValue([{ deleted: 0 }]);

    const firstRun = task.run();
    await task.run(); // second call while first is in flight — should no-op

    resolveFirst([{ deleted: 0 }]);
    await firstRun;

    // The concurrent second run bailed before calling query again, so total calls === rules (21).
    expect(dataSource.query).toHaveBeenCalledTimes(21);
  });
});
