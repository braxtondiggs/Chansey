import { Injectable, Logger } from '@nestjs/common';

/**
 * Circuit breaker states
 */
export enum CircuitState {
  /** Normal operation - requests pass through */
  CLOSED = 'closed',
  /** Circuit tripped - requests fail fast */
  OPEN = 'open',
  /** Testing recovery - limited requests allowed */
  HALF_OPEN = 'half_open'
}

/**
 * Circuit breaker configuration options
 */
export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold?: number;
  /** Number of successes in half-open before closing (default: 2) */
  successThreshold?: number;
  /** Time in ms before attempting recovery (default: 30000) */
  resetTimeoutMs?: number;
  /** Time window in ms for failure counting (default: 60000) */
  failureWindowMs?: number;
}

/**
 * Default circuit breaker options
 */
export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: Required<CircuitBreakerOptions> = {
  failureThreshold: 5,
  successThreshold: 2,
  resetTimeoutMs: 30000,
  failureWindowMs: 60000
};

/**
 * Internal state for a single circuit
 */
interface CircuitData {
  state: CircuitState;
  failures: number[];
  consecutiveSuccesses: number;
  lastFailureTime: number | null;
  openedAt: number | null;
  options: Required<CircuitBreakerOptions>;
}

/**
 * Circuit breaker statistics
 */
export interface CircuitStats {
  circuitKey: string;
  state: CircuitState;
  failureCount: number;
  consecutiveSuccesses: number;
  lastFailureTime: Date | null;
  openedAt: Date | null;
  timeUntilHalfOpen: number | null;
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(
    public readonly circuitKey: string,
    public readonly timeUntilHalfOpen: number
  ) {
    super(`Circuit breaker '${circuitKey}' is OPEN. Retry in ${Math.ceil(timeUntilHalfOpen / 1000)}s`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * CircuitBreakerService
 *
 * Implements the circuit breaker pattern to prevent cascading failures
 * when external services (like exchange APIs) are unavailable.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests fail immediately (fail-fast)
 * - HALF_OPEN: Testing if service has recovered
 *
 * @example
 * ```typescript
 * // Check before making external call
 * this.circuitBreaker.checkCircuit('binance');
 *
 * try {
 *   const result = await exchangeClient.createOrder(...);
 *   this.circuitBreaker.recordSuccess('binance');
 *   return result;
 * } catch (error) {
 *   this.circuitBreaker.recordFailure('binance');
 *   throw error;
 * }
 * ```
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly circuits = new Map<string, CircuitData>();

  /**
   * Get or create a circuit for a given key
   */
  private getCircuit(key: string, options?: CircuitBreakerOptions): CircuitData {
    if (!this.circuits.has(key)) {
      this.circuits.set(key, {
        state: CircuitState.CLOSED,
        failures: [],
        consecutiveSuccesses: 0,
        lastFailureTime: null,
        openedAt: null,
        options: { ...DEFAULT_CIRCUIT_BREAKER_OPTIONS, ...options }
      });
    }
    return this.circuits.get(key)!;
  }

  /**
   * Configure circuit breaker options for a specific key
   */
  configure(key: string, options: CircuitBreakerOptions): void {
    const circuit = this.getCircuit(key);
    circuit.options = { ...circuit.options, ...options };
  }

  /**
   * Check if a circuit allows requests
   * Throws CircuitOpenError if circuit is open
   *
   * @param key - Circuit identifier (e.g., exchange slug)
   * @throws CircuitOpenError if circuit is open
   */
  checkCircuit(key: string): void {
    const circuit = this.getCircuit(key);
    const now = Date.now();

    switch (circuit.state) {
      case CircuitState.CLOSED:
        // Normal operation - allow request
        return;

      case CircuitState.OPEN: {
        // Check if reset timeout has elapsed
        const timeSinceOpen = now - (circuit.openedAt || 0);
        if (timeSinceOpen >= circuit.options.resetTimeoutMs) {
          // Transition to half-open
          circuit.state = CircuitState.HALF_OPEN;
          circuit.consecutiveSuccesses = 0;
          this.logger.log(`Circuit '${key}' transitioning to HALF_OPEN after ${timeSinceOpen}ms`);
          return;
        }

        // Still in cooldown - reject
        const timeUntilHalfOpen = circuit.options.resetTimeoutMs - timeSinceOpen;
        throw new CircuitOpenError(key, timeUntilHalfOpen);
      }

      case CircuitState.HALF_OPEN:
        // Allow limited requests to test recovery
        return;
    }
  }

  /**
   * Check if circuit is open (non-throwing version)
   *
   * @param key - Circuit identifier
   * @returns true if circuit is open and requests should be blocked
   */
  isOpen(key: string): boolean {
    try {
      this.checkCircuit(key);
      return false;
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        return true;
      }
      throw error;
    }
  }

  /**
   * Record a successful operation
   *
   * @param key - Circuit identifier
   */
  recordSuccess(key: string): void {
    const circuit = this.getCircuit(key);

    switch (circuit.state) {
      case CircuitState.CLOSED:
        // Already closed, nothing to do
        break;

      case CircuitState.HALF_OPEN:
        circuit.consecutiveSuccesses++;
        if (circuit.consecutiveSuccesses >= circuit.options.successThreshold) {
          // Recovery confirmed - close circuit
          circuit.state = CircuitState.CLOSED;
          circuit.failures = [];
          circuit.consecutiveSuccesses = 0;
          circuit.openedAt = null;
          this.logger.log(`Circuit '${key}' CLOSED after successful recovery`);
        }
        break;

      case CircuitState.OPEN:
        // Shouldn't happen - ignore
        break;
    }
  }

  /**
   * Record a failed operation
   *
   * @param key - Circuit identifier
   */
  recordFailure(key: string): void {
    const circuit = this.getCircuit(key);
    const now = Date.now();

    // Clean up old failures outside the window
    circuit.failures = circuit.failures.filter((timestamp) => now - timestamp < circuit.options.failureWindowMs);

    // Record this failure
    circuit.failures.push(now);
    circuit.lastFailureTime = now;

    switch (circuit.state) {
      case CircuitState.CLOSED:
        // Check if we should open the circuit
        if (circuit.failures.length >= circuit.options.failureThreshold) {
          circuit.state = CircuitState.OPEN;
          circuit.openedAt = now;
          this.logger.warn(
            `Circuit '${key}' OPENED after ${circuit.failures.length} failures in ${circuit.options.failureWindowMs}ms`
          );
        }
        break;

      case CircuitState.HALF_OPEN:
        // Failed during recovery - reopen circuit
        circuit.state = CircuitState.OPEN;
        circuit.openedAt = now;
        circuit.consecutiveSuccesses = 0;
        this.logger.warn(`Circuit '${key}' re-OPENED after failure during recovery`);
        break;

      case CircuitState.OPEN:
        // Already open - update opened time to extend cooldown
        circuit.openedAt = now;
        break;
    }
  }

  /**
   * Get current state of a circuit
   *
   * @param key - Circuit identifier
   * @returns Circuit state
   */
  getState(key: string): CircuitState {
    // Check circuit to handle state transitions
    try {
      this.checkCircuit(key);
    } catch {
      // Ignore - we just want the state
    }
    return this.getCircuit(key).state;
  }

  /**
   * Get statistics for a circuit
   *
   * @param key - Circuit identifier
   * @returns Circuit statistics
   */
  getStats(key: string): CircuitStats {
    const circuit = this.getCircuit(key);
    const now = Date.now();

    // Clean up old failures for accurate count
    const recentFailures = circuit.failures.filter((timestamp) => now - timestamp < circuit.options.failureWindowMs);

    let timeUntilHalfOpen: number | null = null;
    if (circuit.state === CircuitState.OPEN && circuit.openedAt) {
      const timeSinceOpen = now - circuit.openedAt;
      if (timeSinceOpen < circuit.options.resetTimeoutMs) {
        timeUntilHalfOpen = circuit.options.resetTimeoutMs - timeSinceOpen;
      }
    }

    return {
      circuitKey: key,
      state: circuit.state,
      failureCount: recentFailures.length,
      consecutiveSuccesses: circuit.consecutiveSuccesses,
      lastFailureTime: circuit.lastFailureTime ? new Date(circuit.lastFailureTime) : null,
      openedAt: circuit.openedAt ? new Date(circuit.openedAt) : null,
      timeUntilHalfOpen
    };
  }

  /**
   * Get statistics for all circuits
   *
   * @returns Array of circuit statistics
   */
  getAllStats(): CircuitStats[] {
    return Array.from(this.circuits.keys()).map((key) => this.getStats(key));
  }

  /**
   * Manually reset a circuit to closed state
   *
   * @param key - Circuit identifier
   */
  reset(key: string): void {
    const circuit = this.getCircuit(key);
    circuit.state = CircuitState.CLOSED;
    circuit.failures = [];
    circuit.consecutiveSuccesses = 0;
    circuit.lastFailureTime = null;
    circuit.openedAt = null;
    this.logger.log(`Circuit '${key}' manually RESET to CLOSED`);
  }

  /**
   * Manually trip (open) a circuit
   *
   * @param key - Circuit identifier
   */
  trip(key: string): void {
    const circuit = this.getCircuit(key);
    circuit.state = CircuitState.OPEN;
    circuit.openedAt = Date.now();
    this.logger.warn(`Circuit '${key}' manually TRIPPED to OPEN`);
  }
}
