import { ShutdownSignalService } from './shutdown-signal.service';

describe('ShutdownSignalService', () => {
  let service: ShutdownSignalService;

  beforeEach(() => {
    service = new ShutdownSignalService();
  });

  it('starts in a non-shutdown state', () => {
    expect(service.isShuttingDown).toBe(false);
    expect(service.signal.aborted).toBe(false);
  });

  it('trigger() sets the shutdown signal', () => {
    service.trigger();
    expect(service.isShuttingDown).toBe(true);
    expect(service.signal.aborted).toBe(true);
  });

  it('trigger() is idempotent', () => {
    service.trigger();
    service.trigger();
    expect(service.isShuttingDown).toBe(true);
  });

  it('signal fires the abort event', () => {
    const handler = jest.fn();
    service.signal.addEventListener('abort', handler);
    service.trigger();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
