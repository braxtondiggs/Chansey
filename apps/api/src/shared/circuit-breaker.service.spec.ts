import { CircuitBreakerService, CircuitOpenError, CircuitState } from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(() => {
    service = new CircuitBreakerService();
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(service.getState('test-exchange')).toBe(CircuitState.CLOSED);
    });

    it('should allow requests when CLOSED', () => {
      expect(() => service.checkCircuit('test-exchange')).not.toThrow();
    });
  });

  describe('failure tracking', () => {
    it('should track failures and open circuit after threshold', () => {
      service.configure('test-exchange', { failureThreshold: 3, failureWindowMs: 60000 });

      service.recordFailure('test-exchange');
      expect(service.getState('test-exchange')).toBe(CircuitState.CLOSED);

      service.recordFailure('test-exchange');
      expect(service.getState('test-exchange')).toBe(CircuitState.CLOSED);

      service.recordFailure('test-exchange');
      expect(service.getState('test-exchange')).toBe(CircuitState.OPEN);
    });

    it('should reject requests when OPEN', () => {
      service.configure('test-exchange', { failureThreshold: 1 });
      service.recordFailure('test-exchange');

      expect(() => service.checkCircuit('test-exchange')).toThrow(CircuitOpenError);
    });

    it('should report correct stats', () => {
      service.configure('test-exchange', { failureThreshold: 5 });
      service.recordFailure('test-exchange');
      service.recordFailure('test-exchange');

      const stats = service.getStats('test-exchange');
      expect(stats.circuitKey).toBe('test-exchange');
      expect(stats.state).toBe(CircuitState.CLOSED);
      expect(stats.failureCount).toBe(2);
    });
  });

  describe('recovery', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      service.configure('test-exchange', { failureThreshold: 1, resetTimeoutMs: 50 });
      service.recordFailure('test-exchange');
      expect(service.getState('test-exchange')).toBe(CircuitState.OPEN);

      // Wait for reset timeout
      jest.advanceTimersByTime(60);

      // checkCircuit should transition to HALF_OPEN
      expect(() => service.checkCircuit('test-exchange')).not.toThrow();
      expect(service.getState('test-exchange')).toBe(CircuitState.HALF_OPEN);
    });

    it('should close circuit after consecutive successes in HALF_OPEN', async () => {
      service.configure('test-exchange', { failureThreshold: 1, successThreshold: 2, resetTimeoutMs: 10 });
      service.recordFailure('test-exchange');

      jest.advanceTimersByTime(20);
      service.checkCircuit('test-exchange'); // Transitions to HALF_OPEN

      service.recordSuccess('test-exchange');
      expect(service.getState('test-exchange')).toBe(CircuitState.HALF_OPEN);

      service.recordSuccess('test-exchange');
      expect(service.getState('test-exchange')).toBe(CircuitState.CLOSED);
    });

    it('should reopen circuit on failure during HALF_OPEN', async () => {
      service.configure('test-exchange', { failureThreshold: 1, resetTimeoutMs: 10 });
      service.recordFailure('test-exchange');

      jest.advanceTimersByTime(20);
      service.checkCircuit('test-exchange'); // Transitions to HALF_OPEN

      service.recordFailure('test-exchange');
      expect(service.getState('test-exchange')).toBe(CircuitState.OPEN);
    });
  });

  describe('isOpen', () => {
    it('should return false when CLOSED', () => {
      expect(service.isOpen('test-exchange')).toBe(false);
    });

    it('should return true when OPEN', () => {
      service.configure('test-exchange', { failureThreshold: 1 });
      service.recordFailure('test-exchange');
      expect(service.isOpen('test-exchange')).toBe(true);
    });
  });

  describe('manual controls', () => {
    it('should manually reset circuit to CLOSED', () => {
      service.configure('test-exchange', { failureThreshold: 1 });
      service.recordFailure('test-exchange');
      expect(service.getState('test-exchange')).toBe(CircuitState.OPEN);

      service.reset('test-exchange');
      expect(service.getState('test-exchange')).toBe(CircuitState.CLOSED);
    });

    it('should manually trip circuit to OPEN', () => {
      expect(service.getState('test-exchange')).toBe(CircuitState.CLOSED);

      service.trip('test-exchange');
      expect(service.getState('test-exchange')).toBe(CircuitState.OPEN);
    });
  });

  describe('multiple circuits', () => {
    it('should maintain separate state per circuit', () => {
      service.configure('exchange-a', { failureThreshold: 1 });
      service.configure('exchange-b', { failureThreshold: 2 });

      service.recordFailure('exchange-a');
      service.recordFailure('exchange-b');

      expect(service.getState('exchange-a')).toBe(CircuitState.OPEN);
      expect(service.getState('exchange-b')).toBe(CircuitState.CLOSED);
    });

    it('should return stats for all circuits', () => {
      service.recordFailure('exchange-a');
      service.recordFailure('exchange-b');

      const allStats = service.getAllStats();
      expect(allStats).toHaveLength(2);
      expect(allStats.map((s) => s.circuitKey)).toContain('exchange-a');
      expect(allStats.map((s) => s.circuitKey)).toContain('exchange-b');
    });
  });

  describe('CircuitOpenError', () => {
    it('should contain circuit key and time until half-open', () => {
      service.configure('test-exchange', { failureThreshold: 1, resetTimeoutMs: 30000 });
      service.recordFailure('test-exchange');

      try {
        service.checkCircuit('test-exchange');
        fail('Expected CircuitOpenError');
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitOpenError);
        const circuitError = error as CircuitOpenError;
        expect(circuitError.circuitKey).toBe('test-exchange');
        expect(circuitError.timeUntilHalfOpen).toBeGreaterThan(0);
        expect(circuitError.timeUntilHalfOpen).toBeLessThanOrEqual(30000);
      }
    });
  });

  describe('failure window', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should expire old failures outside the window', async () => {
      service.configure('test-exchange', { failureThreshold: 3, failureWindowMs: 50 });

      service.recordFailure('test-exchange');
      service.recordFailure('test-exchange');

      // Wait for failures to expire
      jest.advanceTimersByTime(60);

      // These two failures are within window, but old ones expired
      service.recordFailure('test-exchange');
      service.recordFailure('test-exchange');

      // Should still be CLOSED because old failures expired
      expect(service.getStats('test-exchange').failureCount).toBe(2);
      expect(service.getState('test-exchange')).toBe(CircuitState.CLOSED);
    });
  });
});
