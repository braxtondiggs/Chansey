import { Injectable } from '@angular/core';

import { ExchangeKey, IUser } from '@chansey/api-interfaces';
import { queryKeys, useAuthMutation } from '@chansey/shared';

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

/**
 * Service for user profile management via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class ProfileService {
  /**
   * Update user profile
   */
  useUpdateProfileMutation() {
    return useAuthMutation<IUser, IUserProfileUpdate>('/api/user', 'PATCH', {
      invalidateQueries: [queryKeys.auth.user()]
    });
  }

  /**
   * Change user password
   */
  useChangePasswordMutation() {
    return useAuthMutation<{ message: string }, ChangePasswordRequest>('/api/auth/change-password', 'POST');
  }

  /**
   * Save exchange API keys
   */
  useSaveExchangeKeysMutation() {
    return useAuthMutation<ExchangeKey, Record<string, unknown>>('/api/exchange-keys', 'POST', {
      invalidateQueries: [queryKeys.auth.user(), queryKeys.profile.exchangeKeys()]
    });
  }

  /**
   * Delete exchange API keys
   */
  useDeleteExchangeKeyMutation() {
    return useAuthMutation<ExchangeKey, string>((id: string) => `/api/exchange-keys/${id}`, 'DELETE', {
      invalidateQueries: [queryKeys.auth.user(), queryKeys.profile.exchangeKeys()]
    });
  }

  /**
   * Upload profile image
   */
  useUploadProfileImageMutation() {
    return useAuthMutation<IUser, FormData>('/api/user/profile-image', 'POST', {
      invalidateQueries: [queryKeys.auth.user()]
    });
  }
}
