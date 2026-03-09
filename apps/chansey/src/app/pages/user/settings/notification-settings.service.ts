import { Injectable } from '@angular/core';

import { NotificationPreferences } from '@chansey/api-interfaces';
import { queryKeys, useAuthMutation, useAuthQuery } from '@chansey/shared';

@Injectable({
  providedIn: 'root'
})
export class NotificationSettingsService {
  usePreferencesQuery() {
    return useAuthQuery<NotificationPreferences>(
      queryKeys.notifications.preferences(),
      '/api/notifications/preferences'
    );
  }

  useUpdatePreferencesMutation() {
    return useAuthMutation<NotificationPreferences, Partial<NotificationPreferences>>(
      '/api/notifications/preferences',
      'PATCH',
      {
        invalidateQueries: [queryKeys.notifications.preferences()]
      }
    );
  }

  useVapidKeyQuery() {
    return useAuthQuery<{ key: string }>(queryKeys.notifications.vapidKey(), '/api/notifications/push/vapid-key');
  }
}
