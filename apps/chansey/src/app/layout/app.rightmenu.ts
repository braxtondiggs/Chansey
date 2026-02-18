import { Component, inject } from '@angular/core';

import { DrawerModule } from 'primeng/drawer';

import { CryptoTradingComponent } from '../shared/components/crypto-trading/crypto-trading.component';
import { LayoutService } from '../shared/services/layout.service';

@Component({
  selector: 'app-rightmenu',
  standalone: true,
  imports: [DrawerModule, CryptoTradingComponent],
  template: ` <p-drawer
    header="Spot Trading"
    [(visible)]="rightMenuVisible"
    position="right"
    class="layout-rightmenu !w-full sm:!w-[36rem]"
  >
    @if (rightMenuVisible) {
      <app-crypto-trading />
    }
  </p-drawer>`
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppRightMenu {
  layoutService: LayoutService = inject(LayoutService);

  get rightMenuVisible(): boolean {
    return this.layoutService.layoutState().rightMenuVisible;
  }

  set rightMenuVisible(_val: boolean) {
    this.layoutService.layoutState.update((prev) => ({ ...prev, rightMenuVisible: _val }));
  }
}
