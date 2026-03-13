import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MessageService } from 'primeng/api';
import { PanelModule } from 'primeng/panel';
import { SkeletonModule } from 'primeng/skeleton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { NotificationEventType } from '@chansey/api-interfaces';

import { NotificationSettingsService } from '../../notification-settings.service';
import { HOURS, NOTIFICATION_EVENT_OPTIONS } from '../../settings.constants';
import { NotificationEventOption } from '../../settings.types';
import { createAutoSave } from '../../utils/auto-save';
import { createPanelState } from '../../utils/panel-state';
import { SaveStatusIndicatorComponent } from '../save-status-indicator/save-status-indicator.component';

@Component({
  selector: 'app-notification-settings',
  imports: [FormsModule, PanelModule, SaveStatusIndicatorComponent, SkeletonModule, ToggleSwitchModule],
  templateUrl: './notification-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotificationSettingsComponent {
  private messageService = inject(MessageService);
  private notificationSettingsService = inject(NotificationSettingsService);

  readonly notifPrefsQuery = this.notificationSettingsService.usePreferencesQuery();
  readonly updateNotifPrefsMutation = this.notificationSettingsService.useUpdatePreferencesMutation();
  readonly hours = HOURS;
  readonly autoSave = createAutoSave(() => this.doSave());

  prefChannelEmail = true;
  prefChannelPush = false;
  prefQuietEnabled = false;
  prefQuietStart = 22;
  prefQuietEnd = 7;
  notificationEventOptions: NotificationEventOption[] = structuredClone(NOTIFICATION_EVENT_OPTIONS);

  private panelState = createPanelState('notifications', ['channels', 'events', 'quietHours']);
  panelCollapsed = this.panelState.collapsed;
  onPanelToggle = this.panelState.onToggle;

  constructor() {
    effect(() => {
      const prefs = this.notifPrefsQuery.data();
      if (prefs) {
        this.prefChannelEmail = prefs.channels.email;
        this.prefChannelPush = prefs.channels.push;
        this.prefQuietEnabled = prefs.quietHours.enabled;
        this.prefQuietStart = prefs.quietHours.startHourUtc;
        this.prefQuietEnd = prefs.quietHours.endHourUtc;
        for (const opt of this.notificationEventOptions) {
          opt.enabled = prefs.events[opt.key as NotificationEventType] ?? true;
        }
      }
    });
  }

  saveNotificationPreferences(): void {
    this.autoSave.trigger();
  }

  saveEventPreference(): void {
    this.autoSave.trigger();
  }

  togglePushNotifications(event: { checked: boolean }): void {
    if (event.checked) {
      if ('Notification' in window) {
        Notification.requestPermission().then((permission) => {
          if (permission === 'granted') {
            this.prefChannelPush = true;
            this.autoSave.trigger();
          } else {
            this.prefChannelPush = false;
            this.messageService.add({
              severity: 'warn',
              summary: 'Permission Denied',
              detail: 'Push notification permission was denied'
            });
          }
        });
      } else {
        this.prefChannelPush = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Not Supported',
          detail: 'Your browser does not support push notifications'
        });
      }
    } else {
      this.prefChannelPush = false;
      this.autoSave.trigger();
    }
  }

  private doSave(): void {
    const events: Record<string, boolean> = {};
    for (const opt of this.notificationEventOptions) {
      events[opt.key] = opt.enabled;
    }

    this.updateNotifPrefsMutation.mutate(
      {
        channels: { email: this.prefChannelEmail, push: this.prefChannelPush, sms: false },
        events: events as Record<NotificationEventType, boolean>,
        quietHours: {
          enabled: this.prefQuietEnabled,
          startHourUtc: this.prefQuietStart,
          endHourUtc: this.prefQuietEnd
        }
      },
      {
        onSuccess: () => {
          this.autoSave.markSaved();
        },
        onError: (error: Error) => {
          this.autoSave.markError();
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error?.message || 'Failed to save'
          });
        }
      }
    );
  }
}
