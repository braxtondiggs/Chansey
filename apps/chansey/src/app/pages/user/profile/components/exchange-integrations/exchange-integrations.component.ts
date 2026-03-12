import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output, signal } from '@angular/core';

import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { DividerModule } from 'primeng/divider';
import { FieldsetModule } from 'primeng/fieldset';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { TabsModule } from 'primeng/tabs';

import { Exchange, ExchangeKey, IUser } from '@chansey/api-interfaces';

import { ExchangeFormState } from '../../profile.types';
import { ExchangeKeyFormComponent } from '../exchange-key-form/exchange-key-form.component';

@Component({
  selector: 'app-exchange-integrations',
  standalone: true,
  imports: [
    AvatarModule,
    ButtonModule,
    CardModule,
    DialogModule,
    DividerModule,
    ExchangeKeyFormComponent,
    FieldsetModule,
    MessageModule,
    NgTemplateOutlet,
    SkeletonModule,
    TabsModule
  ],
  templateUrl: './exchange-integrations.component.html'
})
export class ExchangeIntegrationsComponent {
  exchanges = input<Exchange[]>([]);
  exchangeForms = input<Record<string, ExchangeFormState>>({});
  isLoading = input(false);
  isError = input(false);
  user = input<IUser | undefined>();

  saveKeys = output<string>();
  editKeys = output<string>();
  cancelEditKeys = output<string>();
  removeKeys = output<string>();

  showBinanceHelp = signal(false);
  showCoinbaseHelp = signal(false);

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
