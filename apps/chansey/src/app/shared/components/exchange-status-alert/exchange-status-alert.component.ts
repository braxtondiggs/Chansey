import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { ExchangeKeyErrorCategory, ExchangeKeyHealthSummary } from '@chansey/api-interfaces';

import { ExchangeService } from '../../services/exchange.service';

const CRITICAL_CATEGORIES = new Set<ExchangeKeyErrorCategory>(['authentication', 'permission']);

@Component({
  selector: 'app-exchange-status-alert',
  imports: [ButtonModule, MessageModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (key of unhealthyExchanges(); track key.id) {
      <p-message severity="error" class="mb-3 block">
        <ng-template #container>
          <div class="flex w-full flex-wrap items-center justify-between gap-3 p-3">
            <div class="flex items-center gap-2">
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
              <span>
                <strong>{{ key.exchange.name }} Disconnected</strong> —
                @if (key.deactivatedByHealthCheck) {
                  Your API key was deactivated after repeated failures. Please recheck or update your API keys.
                } @else {
                  {{
                    key.lastErrorCategory === 'authentication'
                      ? 'Invalid API credentials.'
                      : 'Insufficient API key permissions.'
                  }}
                  Trading is paused for this exchange.
                }
              </span>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <p-button
                label="Recheck"
                icon="pi pi-refresh"
                severity="danger"
                [outlined]="true"
                size="small"
                [loading]="recheckMutation.isPending() && recheckingKeyId() === key.id"
                (onClick)="recheck(key.id)"
              />
              <p-button
                label="Update API Keys"
                icon="pi pi-arrow-right"
                iconPos="right"
                routerLink="/app/settings"
                severity="danger"
                [outlined]="true"
                size="small"
              />
            </div>
          </div>
        </ng-template>
      </p-message>
    }

    @for (key of degradedExchanges(); track key.id) {
      <p-message severity="warn" class="mb-3 block">
        <ng-template #container>
          <div class="flex w-full flex-wrap items-center justify-between gap-3 p-3">
            <div class="flex items-center gap-2">
              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
              <span>
                <strong>{{ key.exchange.name }} Degraded</strong> — experiencing connectivity issues. Trading may be
                temporarily affected.
              </span>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <p-button
                label="Recheck"
                icon="pi pi-refresh"
                severity="warn"
                [outlined]="true"
                size="small"
                [loading]="recheckMutation.isPending() && recheckingKeyId() === key.id"
                (onClick)="recheck(key.id)"
              />
            </div>
          </div>
        </ng-template>
      </p-message>
    }
  `
})
export class ExchangeStatusAlertComponent {
  private readonly exchangeService = inject(ExchangeService);
  private readonly healthQuery = this.exchangeService.useExchangeHealth();
  readonly recheckMutation = this.exchangeService.useRecheckKeyMutation();
  private readonly recheckingId = signal<string | null>(null);
  readonly recheckingKeyId = computed(() => (this.recheckMutation.isPending() ? this.recheckingId() : null));

  readonly unhealthyExchanges = computed<ExchangeKeyHealthSummary[]>(() => {
    const data = this.healthQuery.data();
    if (!data) return [];
    return data.filter(
      (k) =>
        k.healthStatus === 'deactivated' ||
        (k.healthStatus !== 'healthy' && k.lastErrorCategory !== null && CRITICAL_CATEGORIES.has(k.lastErrorCategory))
    );
  });

  readonly degradedExchanges = computed<ExchangeKeyHealthSummary[]>(() => {
    const data = this.healthQuery.data();
    if (!data) return [];
    const unhealthyIds = new Set(this.unhealthyExchanges().map((k) => k.id));
    return data.filter((k) => k.healthStatus !== 'healthy' && k.healthStatus !== 'unknown' && !unhealthyIds.has(k.id));
  });

  recheck(keyId: string): void {
    this.recheckingId.set(keyId);
    this.recheckMutation.mutate(keyId);
  }
}
