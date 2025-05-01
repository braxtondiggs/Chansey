import { Component, inject } from '@angular/core';

import { LayoutService } from '../services/layout.service';

@Component({
  selector: 'app-footer',
  standalone: true,
  template: `
    <div class="layout-footer">
      <div class="footer-logo-container">
        <img src="/public/icons/icon-72x72.png" alt="Cymbit Trading Logo" />
        <span class="footer-app-name">Cymbit Trading</span>
      </div>
    </div>
  `
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppFooter {
  layoutService = inject(LayoutService);
}
