import { Injectable } from '@angular/core';

import { Coin, OpportunitySellingStatusResponse, OtpResponse } from '@chansey/api-interfaces';
import { queryKeys, useAuthMutation, useAuthQuery } from '@chansey/shared';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  useCoinsQuery() {
    return useAuthQuery<Coin[]>(queryKeys.coins.lists(), '/api/coin');
  }

  useEnableOtpMutation() {
    return useAuthMutation<OtpResponse, void>('/api/auth/enable-otp', 'POST', {
      invalidateQueries: [queryKeys.auth.user()]
    });
  }

  useDisableOtpMutation() {
    return useAuthMutation<OtpResponse, { password: string }>('/api/auth/disable-otp', 'POST', {
      invalidateQueries: [queryKeys.auth.user()]
    });
  }

  useOpportunitySellingQuery() {
    return useAuthQuery<OpportunitySellingStatusResponse>(
      queryKeys.profile.opportunitySelling(),
      '/api/user/opportunity-selling/config'
    );
  }

  useUpdateOpportunitySellingMutation() {
    return useAuthMutation<
      OpportunitySellingStatusResponse,
      Partial<OpportunitySellingStatusResponse['config']> & { enabled?: boolean }
    >('/api/user/opportunity-selling/config', 'PATCH', {
      invalidateQueries: [queryKeys.profile.opportunitySelling(), queryKeys.auth.user()]
    });
  }
}
