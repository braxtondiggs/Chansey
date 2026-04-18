import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, inject, signal, viewChild } from '@angular/core';
import { RouterModule } from '@angular/router';

import { funEmoji } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { AvatarModule } from 'primeng/avatar';
import { BadgeModule } from 'primeng/badge';
import { ButtonModule } from 'primeng/button';
import { RippleModule } from 'primeng/ripple';
import { StyleClassModule } from 'primeng/styleclass';
import { TooltipModule } from 'primeng/tooltip';

import { APP_NAME, NotificationDto, NotificationSeverity } from '@chansey/api-interfaces';

import { AppBreadcrumb } from './app.breadcrumb';
import { NotificationFeedService } from './notification-feed.service';

import { TimeAgoPipe } from '../shared/pipes';
import { AuthService } from '../shared/services/auth.service';
import { LayoutService } from '../shared/services/layout.service';
import { PwaService } from '../shared/services/pwa.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [
    AvatarModule,
    AppBreadcrumb,
    BadgeModule,
    RouterModule,
    StyleClassModule,
    CommonModule,
    ButtonModule,
    RippleModule,
    TooltipModule,
    TimeAgoPipe
  ],
  templateUrl: './app.topbar.html'
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppTopBar {
  readonly appName = APP_NAME;
  layoutService = inject(LayoutService);
  authService = inject(AuthService);
  pwaService = inject(PwaService);
  notificationFeedService = inject(NotificationFeedService);

  user = this.authService.useUser();
  logoutMutation = this.authService.useLogoutMutation();
  hasExchangeKeys = computed(() => (this.user.data()?.exchanges?.length ?? 0) > 0);
  userProfileImage = computed(() => {
    const user = this.user.data();
    if (!user) return '';

    if (user.picture && typeof user.picture === 'string' && user.picture.trim() !== '') {
      return user.picture;
    }

    const avatar = createAvatar(funEmoji, {
      seed: user.id || 'default'
    });

    return avatar.toDataUri();
  });
  usersName = computed(() => {
    const user = this.user.data();
    return `${user?.given_name || ''} ${user?.family_name || ''}`.trim();
  });

  // Notification feed
  notificationsQuery = this.notificationFeedService.useNotificationsQuery(10);
  unreadCountQuery = this.notificationFeedService.useUnreadCountQuery();
  markReadMutation = this.notificationFeedService.useMarkReadMutation();
  markAllReadMutation = this.notificationFeedService.useMarkAllReadMutation();

  notificationTabs = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'critical', label: 'Critical' }
  ];
  selectedTab = signal('all');

  unreadCount = computed(() => this.unreadCountQuery.data()?.count ?? 0);

  notifications = computed(() => {
    const feed = this.notificationsQuery.data();
    return feed?.data ?? [];
  });

  filteredNotifications = computed(() => {
    const all = this.notifications();
    const tab = this.selectedTab();
    switch (tab) {
      case 'unread':
        return all.filter((n) => !n.read);
      case 'critical':
        return all.filter((n) => n.severity === 'critical' || n.severity === 'high');
      default:
        return all;
    }
  });

  @ViewChild('menubutton') menuButton!: ElementRef;
  profileDropdown = viewChild<ElementRef>('profileDropdown');

  logout() {
    this.logoutMutation.mutate(undefined, {
      onSuccess: () => {
        this.closeProfileMenu();
      }
    });
  }

  installApp() {
    this.pwaService.promptInstall();
  }

  onMenuButtonClick() {
    this.layoutService.onMenuToggle();
  }

  showRightMenu() {
    this.layoutService.toggleRightMenu();
  }

  toggleSearchBar() {
    this.layoutService.layoutState.update((value) => ({
      ...value,
      searchBarActive: !value.searchBarActive
    }));
  }

  onNotificationClick(item: NotificationDto) {
    if (!item.read) {
      this.markReadMutation.mutate({ id: item.id });
    }
  }

  markAllRead() {
    this.markAllReadMutation.mutate(undefined);
  }

  getEventIcon(eventType: string): string {
    const icons: Record<string, string> = {
      trade_executed: 'pi pi-chart-line',
      trade_error: 'pi pi-exclamation-triangle',
      risk_breach: 'pi pi-shield',
      drift_alert: 'pi pi-wave-pulse',
      trading_halted: 'pi pi-ban',
      daily_summary: 'pi pi-calendar',
      strategy_deployed: 'pi pi-check-circle',
      strategy_demoted: 'pi pi-arrow-down',
      daily_loss_limit: 'pi pi-exclamation-circle',
      pipeline_started: 'pi pi-play-circle',
      pipeline_stage_completed: 'pi pi-forward',
      pipeline_completed: 'pi pi-verified',
      pipeline_rejected: 'pi pi-times-circle',
      strategy_live: 'pi pi-bolt'
    };
    return icons[eventType] || 'pi pi-bell';
  }

  getSeverityClasses(severity: NotificationSeverity): string {
    switch (severity) {
      case 'critical':
        return 'text-red-600 bg-red-100 dark:bg-red-900';
      case 'high':
        return 'text-orange-600 bg-orange-100 dark:bg-orange-900';
      case 'medium':
        return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900';
      case 'low':
        return 'text-blue-600 bg-blue-100 dark:bg-blue-900';
      default:
        return 'text-gray-500 bg-gray-100 dark:bg-gray-700';
    }
  }

  closeProfileMenu() {
    const dropdown = this.profileDropdown();
    if (dropdown) {
      dropdown.nativeElement.classList.add('hidden');
    }
  }
}
