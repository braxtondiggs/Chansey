import { Injectable } from '@nestjs/common';

/**
 * Lightweight wrapper around an AbortController that signals
 * an impending application shutdown.  Engine loops check the
 * exposed `signal` to bail out early and write an emergency
 * checkpoint before the SIGTERM grace period expires.
 */
@Injectable()
export class ShutdownSignalService {
  private readonly controller = new AbortController();

  /** Pass this to engine loops so they can check `.aborted` */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get isShuttingDown(): boolean {
    return this.controller.signal.aborted;
  }

  /** Called by ShutdownService as the first action in onApplicationShutdown */
  trigger(): void {
    if (!this.controller.signal.aborted) {
      this.controller.abort();
    }
  }
}
