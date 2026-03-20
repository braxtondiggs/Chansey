import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DividerModule } from 'primeng/divider';
import { FieldsetModule } from 'primeng/fieldset';
import { MessageModule } from 'primeng/message';
import { PanelModule } from 'primeng/panel';
import { SkeletonModule } from 'primeng/skeleton';
import { TabsModule } from 'primeng/tabs';

import { Exchange, ExchangeKey, IUser } from '@chansey/api-interfaces';

import { ExchangeFormState } from '../../settings.types';
import { createSinglePanelState } from '../../utils/panel-state';
import { ExchangeKeyFormComponent } from '../exchange-key-form/exchange-key-form.component';

@Component({
  selector: 'app-exchange-integrations',
  imports: [
    AvatarModule,
    ButtonModule,
    DialogModule,
    DividerModule,
    ExchangeKeyFormComponent,
    FieldsetModule,
    MessageModule,
    NgTemplateOutlet,
    PanelModule,
    SkeletonModule,
    TabsModule
  ],
  templateUrl: './exchange-integrations.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExchangeIntegrationsComponent {
  collapsible = input(true);
  showHeader = input(true);
  exchanges = input<Exchange[]>([]);
  exchangeForms = input<Record<string, ExchangeFormState>>({});
  hideKeyActions = input(false);
  isLoading = input(false);
  isError = input(false);
  user = input<IUser | undefined>();

  saveKeys = output<string>();
  editKeys = output<string>();
  cancelEditKeys = output<string>();
  removeKeys = output<string>();

  showBinanceHelp = signal(false);
  showCoinbaseHelp = signal(false);

  private panelState = createSinglePanelState('trading.exchangeIntegrations');
  get panelCollapsed() {
    return this.panelState.collapsed;
  }
  onPanelToggle = this.panelState.onToggle;

  isConnected(slug: string): boolean {
    return !!this.exchangeForms()[slug]?.connected;
  }

  isExchangeActive(exchangeId: string): boolean {
    const userData = this.user();
    return !!userData?.exchanges?.find((ex: ExchangeKey) => ex.exchangeId === exchangeId)?.isActive;
  }

  onShowHelp(exchangeSlug: string): void {
    if (exchangeSlug === 'binance-us') {
      this.showBinanceHelp.set(true);
    } else if (exchangeSlug === 'coinbase') {
      this.showCoinbaseHelp.set(true);
    }
  }
}
