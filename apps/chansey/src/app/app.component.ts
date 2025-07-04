import { Component, inject, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';

import { MessageService } from 'primeng/api';

import { PwaToastComponent } from '@chansey-web/app/shared/components';
import { TitleService, SessionActivityService, AuthService } from '@chansey-web/app/shared/services';

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
export class AppComponent implements OnInit {
  // 15 minutes of inactivity before auto logout (in milliseconds)
  private readonly IDLE_TIMEOUT = 15 * 60 * 1000;
  private readonly titleService = inject(TitleService);
  private readonly sessionActivityService = inject(SessionActivityService);
  private readonly authService = inject(AuthService);

  ngOnInit() {
    this.titleService.init();

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
}
