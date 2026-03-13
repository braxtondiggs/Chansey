import { CurrencyPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AutoCompleteModule, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { AutoFocusModule } from 'primeng/autofocus';
import { DialogModule } from 'primeng/dialog';

import { Coin } from '@chansey/api-interfaces';
import { queryKeys, useAuthQuery } from '@chansey/shared';

import { LayoutService } from '../shared/services/layout.service';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [AutoCompleteModule, AutoFocusModule, CurrencyPipe, DialogModule, FormsModule],
  template: ` <p-dialog
    [(visible)]="searchBarActive"
    [breakpoints]="{ '992px': '75vw', '576px': '90vw' }"
    [style]="{ width: '60vw' }"
    modal
    dismissableMask
  >
    <ng-template #headless>
      <div class="search-container">
        <i class="pi pi-search"></i>
        <p-autocomplete
          [ngModel]="selectedCoin()"
          (ngModelChange)="selectedCoin.set($event)"
          [suggestions]="coinSuggestions()"
          (completeMethod)="searchCoins($event)"
          (onSelect)="onCoinSelect($event)"
          optionLabel="name"
          [minLength]="1"
          placeholder="Search coins..."
          [pAutoFocus]="true"
          class="search-autocomplete"
        >
          <ng-template #item let-coin>
            <div class="flex w-full items-center gap-3">
              @if (coin.image) {
                <img [src]="coin.image" [alt]="coin.name" class="h-6 w-6 rounded-full" />
              } @else {
                <div
                  class="bg-surface-200 dark:bg-surface-700 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
                >
                  {{ coin.symbol?.charAt(0) || '?' }}
                </div>
              }
              <div class="flex flex-col">
                <span class="font-medium">{{ coin.name }}</span>
                <span class="text-surface-500 text-xs uppercase">{{ coin.symbol }}</span>
              </div>
              @if (coin.currentPrice !== null && coin.currentPrice !== undefined) {
                <span class="text-surface-500 ml-auto text-sm">{{
                  coin.currentPrice | currency: 'USD' : 'symbol' : '1.2-2'
                }}</span>
              }
            </div>
          </ng-template>
        </p-autocomplete>
      </div>
    </ng-template>
  </p-dialog>`
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppSearch {
  private router = inject(Router);
  private layoutService = inject(LayoutService);

  readonly coinsQuery = useAuthQuery<Coin[]>(() => ({
    queryKey: queryKeys.coins.lists(),
    url: '/api/coin',
    options: { enabled: this.searchBarActive }
  }));

  selectedCoin = signal<Coin | null>(null);
  coinSuggestions = signal<Coin[]>([]);

  searchCoins(event: { query: string }): void {
    const coins = this.coinsQuery.data();
    if (!coins) {
      this.coinSuggestions.set([]);
      return;
    }
    const query = event.query.toLowerCase();
    const suggestions: Coin[] = [];
    for (const c of coins) {
      if (c.name.toLowerCase().includes(query) || c.symbol?.toLowerCase()?.includes(query)) {
        suggestions.push(c);
        if (suggestions.length >= 10) break;
      }
    }
    this.coinSuggestions.set(suggestions);
  }

  onCoinSelect(event: AutoCompleteSelectEvent): void {
    const coin = event.value as Coin;
    this.searchBarActive = false;
    this.selectedCoin.set(null);
    this.router.navigate(['/app/coins', coin.slug]);
  }

  get searchBarActive(): boolean {
    return this.layoutService.layoutState().searchBarActive;
  }

  set searchBarActive(_val: boolean) {
    this.layoutService.layoutState.update((prev) => ({ ...prev, searchBarActive: _val }));
  }
}
