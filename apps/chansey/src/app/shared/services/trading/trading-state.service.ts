import { Injectable } from '@angular/core';

import { BehaviorSubject } from 'rxjs';

import { TickerPair } from '@chansey/api-interfaces';

/**
 * Service for managing local trading state (selected pair, etc.)
 */
@Injectable({
  providedIn: 'root'
})
export class TradingStateService {
  // Real-time state subjects for local state management
  private readonly selectedPairSubject = new BehaviorSubject<TickerPair | null>(null);

  // Public observables
  readonly selectedPair$ = this.selectedPairSubject.asObservable();

  /**
   * Set selected trading pair
   */
  setSelectedPair(pair: TickerPair): void {
    this.selectedPairSubject.next(pair);
  }

  /**
   * Get current selected pair
   */
  getSelectedPair(): TickerPair | null {
    return this.selectedPairSubject.value;
  }
}
