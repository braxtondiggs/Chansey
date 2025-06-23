import { Injectable } from '@angular/core';

import { ExchangeKey, IUser } from '@chansey/api-interfaces';

import { useAuthMutation } from '@chansey-web/app/core/query';
import { authKeys } from '@chansey-web/app/shared/services/auth.service';

// Define query keys for profile related data
export const profileKeys = {
  all: ['profile'] as const,
  exchangeKeys: () => [...profileKeys.all, 'exchange-keys'] as const
};

export interface IUserProfileUpdate {
  given_name?: string;
  family_name?: string;
  middle_name?: string;
  nickname?: string;
  preferred_username?: string;
  picture?: string;
  gender?: string;
  birthdate?: string;
  phone_number?: string;
  risk?: string;
  hide_balance?: boolean;
}

export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
  confirm_new_password: string;
}

@Injectable({
  providedIn: 'root'
})
export class ProfileService {
  useUpdateProfileMutation() {
    return useAuthMutation<IUser, IUserProfileUpdate>('/api/user', 'PATCH', {
      invalidateQueries: [authKeys.user]
    });
  }

  useChangePasswordMutation() {
    return useAuthMutation<{ message: string }, ChangePasswordRequest>('/api/auth/change-password', 'POST');
  }

  useSaveExchangeKeysMutation() {
    return useAuthMutation<ExchangeKey, any>('/api/exchange-keys', 'POST', {
      invalidateQueries: [authKeys.user]
    });
  }

  useDeleteExchangeKeyMutation() {
    return useAuthMutation<ExchangeKey, string>((id: string) => `/api/exchange-keys/${id}`, 'DELETE', {
      invalidateQueries: [authKeys.user]
    });
  }

  useUploadProfileImageMutation() {
    return useAuthMutation<IUser, FormData>('/api/user/profile-image', 'POST', {
      invalidateQueries: [authKeys.user]
    });
  }
}
