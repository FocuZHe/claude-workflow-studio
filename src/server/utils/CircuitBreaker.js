// Simple circuit breaker for repeated API call failures.
// When failures exceed threshold within the window, the circuit
// opens (prevents further attempts) for a cooldown period.

const STATE = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half-open' };

const DEFAULT_OPTIONS = {
  failureThreshold: 5,     // consecutive failures to trip
  cooldownMs: 30000,       // wait 30s before allowing retry
  halfOpenMaxAttempts: 2,  // max attempts in half-open state before re-opening
};

class CircuitBreaker {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.state = STATE.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.halfOpenAttempts = 0;
    this.lastSuccessTime = null;
  }

  /**
   * Call the given async function, protected by the circuit breaker.
   * If the circuit is open, rejects immediately with CIRCUIT_OPEN.
   */
  async call(fn) {
    if (this.state === STATE.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.options.cooldownMs) {
        this.state = STATE.HALF_OPEN;
        this.halfOpenAttempts = 0;
      } else {
        const remaining = Math.ceil((this.options.cooldownMs - (Date.now() - this.lastFailureTime)) / 1000);
        throw Object.assign(new Error(`Circuit breaker open — cooling down (${remaining}s remaining)`), {
          errorType: 'CIRCUIT_OPEN', retryable: true
        });
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    }
  }

  _onSuccess() {
    this.failureCount = 0;
    this.lastSuccessTime = Date.now();
    this.state = STATE.CLOSED;
    this.halfOpenAttempts = 0;
  }

  _onFailure(err) {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === STATE.HALF_OPEN) {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.options.halfOpenMaxAttempts) {
        this.state = STATE.OPEN;
      }
    } else if (this.failureCount >= this.options.failureThreshold) {
      this.state = STATE.OPEN;
    }
  }

  getStatus() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime
    };
  }

  reset() {
    this.state = STATE.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.halfOpenAttempts = 0;
  }
}

// Per-model circuit breakers — shared across the process
const circuits = {
  default: new CircuitBreaker({ failureThreshold: 5, cooldownMs: 30000 }),
  // Shorter cooldown for token errors (usually transient)
  token: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 15000 }),
};

module.exports = { CircuitBreaker, circuits };
