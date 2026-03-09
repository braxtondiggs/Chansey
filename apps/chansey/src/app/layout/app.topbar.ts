import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';

import { funEmoji } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { AvatarModule } from 'primeng/avatar';
import { BadgeModule } from 'primeng/badge';
import { ButtonModule } from 'primeng/button';
import { StyleClassModule } from 'primeng/styleclass';
import { TooltipModule } from 'primeng/tooltip';

import { NotificationDto, NotificationSeverity } from '@chansey/api-interfaces';

import { AppBreadcrumb } from './app.breadcrumb';
import { NotificationFeedService } from './notification-feed.service';

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
    TooltipModule
  ],
  template: `<div class="layout-topbar">
    <div class="topbar-left">
      <a tabindex="0" #menubutton type="button" class="menu-button" (click)="onMenuButtonClick()">
        <i class="pi pi-chevron-left"></i>
      </a>
      <img class="horizontal-logo" src="/layout/images/logo-white.svg" alt="diamond-layout" />
      <span class="topbar-separator"></span>
      <app-breadcrumb></app-breadcrumb>
      <img class="mobile-logo" src="/public/icon.png" alt="cymbit trading icon" />
    </div>

    <div class="topbar-right">
      <ul class="topbar-menu">
        @if (pwaService.installable$ | async) {
          <li class="right-sidebar-item">
            <button
              type="button"
              class="right-sidebar-button"
              (click)="installApp()"
              pTooltip="Install App for faster access"
              tooltipPosition="bottom"
            >
              <i class="pi pi-download"></i>
            </button>
          </li>
        }
        <li class="right-sidebar-item">
          <a class="right-sidebar-button" (click)="toggleSearchBar()">
            <i class="pi pi-search"></i>
          </a>
        </li>
        <li class="right-sidebar-item static sm:relative">
          <a
            class="right-sidebar-button relative z-50"
            pStyleClass="@next"
            enterFromClass="hidden"
            enterActiveClass="animate-scalein"
            leaveActiveClass="animate-fadeout"
            leaveToClass="hidden"
            [hideOnOutsideClick]="true"
          >
            @if (unreadCount() > 0) {
              <span class="absolute top-2 right-2.5 h-2 w-2 rounded-full bg-red-500"></span>
            }
            <i class="pi pi-bell"></i>
          </a>
          <div
            class="border-surface bg-surface-0 dark:bg-surface-900 absolute top-auto z-50 m-0 mt-2 hidden min-w-72 origin-top list-none overflow-hidden rounded-2xl border shadow-[0px_56px_16px_0px_rgba(0,0,0,0.00),0px_36px_14px_0px_rgba(0,0,0,0.01),0px_20px_12px_0px_rgba(0,0,0,0.02),0px_9px_9px_0px_rgba(0,0,0,0.03),0px_2px_5px_0px_rgba(0,0,0,0.04)] sm:w-[22rem]"
            style="right: -100px"
          >
            <div class="border-surface flex items-center justify-between border-b p-4">
              <span class="label-small text-surface-950 dark:text-surface-0">Notifications</span>
              @if (unreadCount() > 0) {
                <button
                  pRipple
                  class="text-surface-950 dark:text-surface-0 label-x-small hover:bg-emphasis border-surface rounded-lg border px-2 py-1 shadow-[0px_1px_2px_0px_rgba(18,18,23,0.05)] transition-all"
                  (click)="markAllRead()"
                >
                  Mark all as read
                </button>
              }
            </div>
            <!-- Tab navigation -->
            <div class="border-surface flex items-center border-b">
              @for (tab of notificationTabs; track tab.id) {
                <button
                  [ngClass]="{
                    'border-surface-950 dark:border-surface-0': selectedTab() === tab.id,
                    'border-transparent': selectedTab() !== tab.id
                  }"
                  class="inline-flex items-center gap-2 border-b px-3.5 py-2"
                  (click)="selectedTab.set(tab.id)"
                >
                  <span
                    [ngClass]="{
                      'text-surface-950 dark:text-surface-0': selectedTab() === tab.id
                    }"
                    class="label-small"
                    >{{ tab.label }}</span
                  >
                </button>
              }
            </div>
            @if (filteredNotifications().length === 0) {
              <!-- Empty state -->
              <div class="flex flex-col items-center justify-center p-8 text-center">
                <i class="pi pi-bell-slash text-surface-400 mb-3 text-4xl"></i>
                <span class="label-medium text-surface-700 dark:text-surface-300">No notifications yet</span>
                <span class="label-small text-surface-500 dark:text-surface-400 mt-1"
                  >We'll notify you when something important happens</span
                >
              </div>
            } @else {
              <!-- Notification list -->
              <ul class="flex max-h-80 flex-col divide-y divide-[var(--surface-border)] overflow-auto">
                @for (item of filteredNotifications(); track item.id; let i = $index) {
                  <li>
                    <div
                      class="hover:bg-emphasis flex cursor-pointer items-center gap-3 px-4 py-3 transition-all"
                      (click)="onNotificationClick(item)"
                    >
                      <div
                        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                        [style.background-color]="getSeverityBg(item.severity)"
                      >
                        <i [class]="getEventIcon(item.eventType)" [style.color]="getSeverityColor(item.severity)"></i>
                      </div>
                      <div class="flex flex-1 flex-col">
                        <span class="label-small text-surface-950 dark:text-surface-0 line-clamp-1 text-left">{{
                          item.title
                        }}</span>
                        <span class="label-xsmall line-clamp-1 text-left">{{ item.body }}</span>
                        <span class="label-xsmall text-left">{{ getRelativeTime(item.createdAt) }}</span>
                      </div>
                      @if (!item.read) {
                        <span class="h-2 w-2 shrink-0 rounded-full bg-blue-500"></span>
                      }
                    </div>
                  </li>
                }
              </ul>
            }
          </div>
        </li>
        <li class="profile-item static sm:relative">
          <a
            class="right-sidebar-button relative z-50"
            pStyleClass="@next"
            enterFromClass="hidden"
            enterActiveClass="animate-scalein"
            leaveActiveClass="animate-fadeout"
            leaveToClass="hidden"
            [hideOnOutsideClick]="true"
          >
            <p-avatar shape="square" [image]="userProfileImage()" [ariaLabel]="usersName()" />
          </a>
          <div
            class="border-surface bg-surface-0 dark:bg-surface-900 absolute top-auto right-0 z-[999] m-0 mt-2 hidden w-52 origin-top list-none overflow-hidden rounded-2xl border p-2 shadow-[0px_56px_16px_0px_rgba(0,0,0,0.00),0px_36px_14px_0px_rgba(0,0,0,0.01),0px_20px_12px_0px_rgba(0,0,0,0.02),0px_9px_9px_0px_rgba(0,0,0,0.03),0px_2px_5px_0px_rgba(0,0,0,0.04)]"
          >
            <ul class="flex flex-col gap-1">
              <li>
                <a
                  class="label-small dark:text-surface-400 hover:bg-emphasis flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors duration-150"
                  routerLink="/app/profile"
                  (click)="closeProfileMenu()"
                >
                  <i class="pi pi-user"></i>
                  <span>Profile</span>
                </a>
              </li>
              <li>
                <a
                  class="label-small dark:text-surface-400 hover:bg-emphasis flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors duration-150"
                  routerLink="/app/settings"
                  (click)="closeProfileMenu()"
                >
                  <i class="pi pi-cog"></i>
                  <span>Settings</span>
                </a>
              </li>
              <li>
                <a
                  class="label-small dark:text-surface-400 hover:bg-emphasis flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors duration-150"
                  (click)="logout()"
                >
                  <i class="pi pi-power-off"></i>
                  <span>Log out</span>
                </a>
              </li>
            </ul>
          </div>
        </li>
        <li class="right-sidebar-item">
          <a tabindex="0" class="right-sidebar-button" (click)="showRightMenu()">
            <i class="pi pi-align-right"></i>
          </a>
        </li>
      </ul>
    </div>
  </div>`
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppTopBar {
  layoutService = inject(LayoutService);
  authService = inject(AuthService);
  pwaService = inject(PwaService);
  notificationFeedService = inject(NotificationFeedService);

  user = this.authService.useUser();
  logoutMutation = this.authService.useLogoutMutation();
  userLoading = computed(() => this.user.isPending() || this.user.isFetching());
  userProfileImage = computed(() => {
    const user = this.user.data();
    if (!user) return '';

    // If the user has a picture and it's a valid URL, use it
    if (user['picture'] && typeof user['picture'] === 'string' && user['picture'].trim() !== '') {
      // Force image refresh by adding a cache-busting parameter if needed
      return user['picture'] + (user['picture'].includes('?') ? '&' : '?') + 'v=' + new Date().getTime();
    }

    // Otherwise create a fallback avatar
    const avatar = createAvatar(funEmoji, {
      seed: user['id'] || 'default'
    });

    return avatar.toDataUri();
  });
  usersName = computed(() => {
    const user = this.user.data();
    return `${user?.['given_name'] || ''} ${user?.['family_name'] || ''}`.trim();
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
      daily_loss_limit: 'pi pi-exclamation-circle'
    };
    return icons[eventType] || 'pi pi-bell';
  }

  getSeverityColor(severity: NotificationSeverity): string {
    switch (severity) {
      case 'critical':
        return '#DC2626';
      case 'high':
        return '#EA580C';
      case 'medium':
        return '#CA8A04';
      case 'low':
        return '#2563EB';
      default:
        return '#6B7280';
    }
  }

  getSeverityBg(severity: NotificationSeverity): string {
    const dark = this.layoutService.isDarkTheme();
    switch (severity) {
      case 'critical':
        return dark ? '#7F1D1D' : '#FEE2E2';
      case 'high':
        return dark ? '#7C2D12' : '#FFEDD5';
      case 'medium':
        return dark ? '#713F12' : '#FEF9C3';
      case 'low':
        return dark ? '#1E3A5F' : '#DBEAFE';
      default:
        return dark ? '#374151' : '#F3F4F6';
    }
  }

  getRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  /**
   * Closes the profile dropdown menu
   */
  closeProfileMenu() {
    // Find and remove the active class from the profile menu
    const profileMenuElement = document.querySelector('.profile-item div:not(.hidden)');
    if (profileMenuElement) {
      profileMenuElement.classList.add('hidden');
    }
  }
}
