import { AlgorithmWatchdog } from './algorithm-watchdog';

describe('AlgorithmWatchdog', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('should initialize with current time', () => {
    const watchdog = new AlgorithmWatchdog(5000);
    // Immediately after construction, checkStall should not throw
    expect(() => watchdog.checkStall('0/100')).not.toThrow();
  });

  it('should not throw when within the stall window', () => {
    const watchdog = new AlgorithmWatchdog(10_000);
    jest.advanceTimersByTime(9_999);
    expect(() => watchdog.checkStall('50/100')).not.toThrow();
  });

  it('should throw when elapsed time exceeds the timeout', () => {
    const watchdog = new AlgorithmWatchdog(5000);
    jest.advanceTimersByTime(5001);
    expect(() => watchdog.checkStall('42/100')).toThrow('Algorithm stalled for 5000ms at iteration 42/100');
  });

  it('should reset the timer on recordSuccess()', () => {
    const watchdog = new AlgorithmWatchdog(5000);
    jest.advanceTimersByTime(4000);
    watchdog.recordSuccess();
    jest.advanceTimersByTime(4000);
    // Total elapsed since construction = 8000ms, but only 4000ms since last success
    expect(() => watchdog.checkStall('10/20')).not.toThrow();
  });

  it('should throw after timeout following a reset', () => {
    const watchdog = new AlgorithmWatchdog(5000);
    watchdog.recordSuccess();
    jest.advanceTimersByTime(5001);
    expect(() => watchdog.checkStall('99/100')).toThrow('Algorithm stalled for 5000ms at iteration 99/100');
  });
});
