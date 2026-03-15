import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

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
    class="layout-rightmenu w-full! sm:w-xl!"
  >
    @if (rightMenuVisible) {
      <app-crypto-trading />
    }
  </p-drawer>`
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppRightMenu implements OnInit {
  private layoutService = inject(LayoutService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  ngOnInit() {
    if (this.route.snapshot.queryParamMap.get('trading') === 'open') {
      this.layoutService.updateLayoutState({ rightMenuVisible: true });
    }
  }

  get rightMenuVisible(): boolean {
    return this.layoutService.layoutState().rightMenuVisible;
  }

  set rightMenuVisible(val: boolean) {
    this.layoutService.layoutState.update((prev) => ({ ...prev, rightMenuVisible: val }));
    this.router.navigate([], {
      queryParams: { trading: val ? 'open' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }
}
