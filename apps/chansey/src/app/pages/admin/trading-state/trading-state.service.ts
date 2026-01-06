import { Injectable } from '@angular/core';

import {
  CancelAllOrdersResult,
  HaltTradingRequest,
  ResumeTradingRequest,
  TradingStateDto
} from '@chansey/api-interfaces';
import { FREQUENT_POLICY, queryKeys, useAuthMutation, useAuthQuery } from '@chansey/shared';

/**
 * Service for managing global trading state (kill switch) via TanStack Query
 *
 * Admin-only endpoints for emergency trading halt/resume.
 */
@Injectable({
  providedIn: 'root'
})
export class TradingStateService {
  private readonly apiUrl = '/api/admin/trading';

  /**
   * Query current trading state
   *
   * Uses FREQUENT policy to refresh often during emergencies
   */
  useTradingState() {
    return useAuthQuery<TradingStateDto>(queryKeys.admin.tradingState(), `${this.apiUrl}/status`, {
      cachePolicy: FREQUENT_POLICY
    });
  }

  /**
   * Halt all trading globally
   */
  useHaltTrading() {
    return useAuthMutation<TradingStateDto, HaltTradingRequest>(`${this.apiUrl}/halt`, 'POST', {
      invalidateQueries: [queryKeys.admin.all]
    });
  }

  /**
   * Resume trading after halt
   */
  useResumeTrading() {
    return useAuthMutation<TradingStateDto, ResumeTradingRequest>(`${this.apiUrl}/resume`, 'POST', {
      invalidateQueries: [queryKeys.admin.all]
    });
  }

  /**
   * Cancel all open orders across all users
   */
  useCancelAllOrders() {
    return useAuthMutation<CancelAllOrdersResult, void>(`${this.apiUrl}/cancel-all-orders`, 'POST', {
      invalidateQueries: [queryKeys.admin.all]
    });
  }
}
