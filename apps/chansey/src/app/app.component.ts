import { Component, inject, NgZone, OnDestroy, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';

import { MessageService } from 'primeng/api';

import { PwaToastComponent } from '@chansey-web/app/shared/components';
import { AuthService, SessionActivityService, TitleService } from '@chansey-web/app/shared/services';

@Component({
  selector: 'app-root',
  template: `
    <router-outlet></router-outlet>
    <app-pwa-toast></app-pwa-toast>
  `,
  imports: [RouterModule, PwaToastComponent],
  providers: [MessageService],
  standalone: true
})
export class AppComponent implements OnInit, OnDestroy {
  // 30 minutes of inactivity before auto logout (in milliseconds)
  private readonly IDLE_TIMEOUT = 30 * 60 * 1000;
  private readonly titleService = inject(TitleService);
  private readonly sessionActivityService = inject(SessionActivityService);
  private readonly authService = inject(AuthService);
  private readonly ngZone = inject(NgZone);

  /** Bound listener reference for cleanup */
  private readonly onSessionExpired = () => {
    // Re-enter Angular zone so Router navigation triggers change detection
    this.ngZone.run(() => this.authService.logout());
  };

  ngOnInit() {
    this.titleService.init();

    // Listen for session-expired events dispatched by authenticatedFetch
    window.addEventListener('auth:session-expired', this.onSessionExpired);

    // Initialize the session activity monitoring for authenticated users
    this.authService.isAuthenticated().subscribe((isAuthenticated: boolean) => {
      if (isAuthenticated) {
        // Start monitoring user activity for auto logout
        this.sessionActivityService.init(this.IDLE_TIMEOUT);
      } else {
        // Stop monitoring if not authenticated
        this.sessionActivityService.stop();
      }
    });
  }

  ngOnDestroy() {
    window.removeEventListener('auth:session-expired', this.onSessionExpired);
  }
}
