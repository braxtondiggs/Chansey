import { Injectable } from '@angular/core';

import { OtpResponse } from '@chansey/api-interfaces';
import { queryKeys, useAuthMutation } from '@chansey/shared';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
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
}
