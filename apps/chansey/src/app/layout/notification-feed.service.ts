import { Injectable } from '@angular/core';

import { NotificationFeedResponse } from '@chansey/api-interfaces';
import { queryKeys, useAuthMutation, useAuthQuery } from '@chansey/shared';

@Injectable({
  providedIn: 'root'
})
export class NotificationFeedService {
  useNotificationsQuery(limit = 10) {
    return useAuthQuery<NotificationFeedResponse>(
      queryKeys.notifications.feed(limit),
      `/api/notifications?limit=${limit}`
    );
  }

  useUnreadCountQuery() {
    return useAuthQuery<{ count: number }>(queryKeys.notifications.unreadCount(), '/api/notifications/unread-count');
  }

  useMarkReadMutation() {
    return useAuthMutation<{ ok: boolean }, { id: string }>((vars) => `/api/notifications/${vars.id}/read`, 'PATCH', {
      invalidateQueries: [queryKeys.notifications.all]
    });
  }

  useMarkAllReadMutation() {
    return useAuthMutation<{ ok: boolean }, void>('/api/notifications/read-all', 'PATCH', {
      invalidateQueries: [queryKeys.notifications.all]
    });
  }
}
