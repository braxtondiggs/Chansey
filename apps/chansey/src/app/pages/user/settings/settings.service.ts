import { Injectable } from '@angular/core';

import {
  ChangePasswordRequest,
  Coin,
  IUser,
  IUserProfileUpdate,
  OpportunitySellingStatusResponse,
  OtpResponse
} from '@chansey/api-interfaces';
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

  useFuturesTradingQuery() {
    return useAuthQuery<{ futuresEnabled: boolean }>(queryKeys.profile.futuresTrading(), '/api/user/futures-trading');
  }

  useUpdateFuturesTradingMutation() {
    return useAuthMutation<{ futuresEnabled: boolean }, { enabled: boolean }>('/api/user/futures-trading', 'PATCH', {
      invalidateQueries: [queryKeys.profile.futuresTrading(), queryKeys.auth.user()]
    });
  }

  useUpdateProfileMutation() {
    return useAuthMutation<IUser, IUserProfileUpdate>('/api/user', 'PATCH', {
      invalidateQueries: [queryKeys.auth.user()]
    });
  }

  useChangePasswordMutation() {
    return useAuthMutation<{ message: string }, ChangePasswordRequest>('/api/auth/change-password', 'POST');
  }

  useUploadProfileImageMutation() {
    return useAuthMutation<IUser, FormData>('/api/user/profile-image', 'POST', {
      invalidateQueries: [queryKeys.auth.user()]
    });
  }
}
