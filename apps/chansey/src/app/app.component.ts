import { Component, inject, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';

import { SessionActivityService, AuthService } from './services';
import { TitleService } from './services/title.service';

@Component({
  selector: 'app-root',
  template: `<router-outlet></router-outlet>`,
  imports: [RouterModule],
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
    this.authService.isAuthenticated().then((isAuthenticated) => {
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
