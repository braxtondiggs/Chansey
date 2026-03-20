import { Component, inject } from '@angular/core';

import { APP_NAME } from '@chansey/api-interfaces';

import { LayoutService } from '../shared/services/layout.service';

@Component({
  selector: 'app-footer',
  standalone: true,
  template: `
    <div class="layout-footer">
      <div class="footer-logo-container">
        <img src="/public/icon.png" [alt]="appName + ' Logo'" />
        <span class="footer-app-name">{{ appName }}</span>
      </div>
    </div>
  `
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppFooter {
  readonly appName = APP_NAME;
  layoutService = inject(LayoutService);
}
