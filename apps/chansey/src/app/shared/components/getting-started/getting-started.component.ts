import { ChangeDetectionStrategy, Component, computed, effect, inject, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ConfirmationService, MessageService } from 'primeng/api';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageModule } from 'primeng/message';
import { PanelModule } from 'primeng/panel';
import { SliderModule } from 'primeng/slider';
import { StepperModule } from 'primeng/stepper';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { APP_NAME, Coin, Exchange, ExchangeKey, OpportunitySellingUserConfig } from '@chansey/api-interfaces';

import { ExchangeIntegrationsComponent } from '../../../pages/user/settings/components/exchange-integrations/exchange-integrations.component';
import { SettingsService } from '../../../pages/user/settings/settings.service';
import { AuthService } from '../../services/auth.service';
import { ExchangeService } from '../../services/exchange.service';
import { ExchangeFormState } from '../../types/exchange-form.types';
import { filterCoinSuggestions } from '../../utils/coin-filter.util';
import { RiskProfileFormComponent } from '../risk-profile-form/risk-profile-form.component';

@Component({
  selector: 'app-getting-started',
  imports: [
    AutoCompleteModule,
    ButtonModule,
    CardModule,
    ConfirmDialogModule,
    ExchangeIntegrationsComponent,
    FormsModule,
    MessageModule,
    PanelModule,
    RiskProfileFormComponent,
    SliderModule,
    StepperModule,
    ToggleSwitchModule
  ],
  providers: [ConfirmationService],
  templateUrl: './getting-started.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GettingStartedComponent {
  readonly appName = APP_NAME;
  private confirmationService = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private authService = inject(AuthService);
  private exchangeService = inject(ExchangeService);
  private settingsService = inject(SettingsService);

  readonly completed = output<void>();

  readonly userQuery = this.authService.useUser();
  readonly supportedExchangesQuery = this.exchangeService.useSupportedExchanges();
  readonly saveExchangeKeysMutation = this.exchangeService.useSaveExchangeKeysMutation();
  readonly deleteExchangeKeyMutation = this.exchangeService.useDeleteExchangeKeyMutation();
  readonly coinsQuery = this.settingsService.useCoinsQuery();
  readonly updateOpportunitySellingMutation = this.settingsService.useUpdateOpportunitySellingMutation();

  activeStep = signal(1);
  exchangeComplete = computed(() => (this.userQuery.data()?.exchanges ?? []).length > 0);
  exchangeKeysValid = computed(() => (this.userQuery.data()?.exchanges ?? []).every((ex) => ex.isActive));
  riskComplete = computed(() => !!this.userQuery.data()?.coinRisk);

  // Step 3: Opportunity Selling
  opportunitySellingEnabled = signal(false);
  protectedCoins = signal<Coin[]>([]);
  maxLiquidationPercent = signal(30);
  protectedCoinSuggestions = signal<Coin[]>([]);

  // Exchange forms
  exchangeForms = signal<Record<string, ExchangeFormState>>({});

  constructor() {
    // Build exchange forms when exchanges + user data are available
    effect(() => {
      const exchanges = this.supportedExchangesQuery.data();
      const userData = this.userQuery.data();
      if (!exchanges || !userData) return;
      this.exchangeForms.set(
        this.exchangeService.buildExchangeForms(
          exchanges,
          userData,
          untracked(() => this.exchangeForms())
        )
      );
    });
  }

  onSaveExchangeKeys(exchangeSlug: string): void {
    const forms = this.exchangeForms();
    const exchange = forms[exchangeSlug];
    if (!exchange) return;

    this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { submitted: true });
    if (!exchange.form.valid) return;

    this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { loading: true });
    const formData = exchange.form.getRawValue();

    const exchangeObj = this.supportedExchangesQuery.data()?.find((ex: Exchange) => ex.slug === exchangeSlug);
    if (!exchangeObj) {
      this.messageService.add({
        severity: 'error',
        summary: 'Connection Failed',
        detail: `Could not find exchange with key: ${exchangeSlug}`
      });
      this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { loading: false });
      return;
    }

    const existingKey = this.userQuery.data()?.exchanges?.find((ex: ExchangeKey) => ex.exchangeId === exchangeObj.id);

    if (existingKey) {
      this.deleteExchangeKeyMutation.mutate(existingKey.id, {
        onSuccess: () => {
          this.exchangeService.saveNewExchangeKey({
            mutation: this.saveExchangeKeysMutation,
            exchangeObj,
            formData,
            formsSignal: this.exchangeForms,
            messageService: this.messageService
          });
        },
        onError: (error: Error) => {
          this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { loading: false });
          this.messageService.add({
            severity: 'error',
            summary: 'Connection Failed',
            detail: error?.message || 'Failed to update exchange keys. Please try again.'
          });
        }
      });
    } else {
      this.exchangeService.saveNewExchangeKey({
        mutation: this.saveExchangeKeysMutation,
        exchangeObj,
        formData,
        formsSignal: this.exchangeForms,
        messageService: this.messageService
      });
    }
  }

  onNextFromExchange(activateCallback: (step: number) => void): void {
    if (this.exchangeKeysValid()) {
      activateCallback(2);
      return;
    }

    this.confirmationService.confirm({
      header: 'Invalid Exchange Keys',
      message:
        'One or more of your exchange API keys failed validation. Trading and portfolio tracking will not work until your keys are valid. Do you want to continue anyway?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Continue Anyway',
      rejectLabel: 'Stay & Fix',
      acceptButtonStyleClass: 'p-button-warning',
      rejectButtonStyleClass: 'p-button-outlined',
      accept: () => activateCallback(2)
    });
  }

  onRiskSaved(): void {
    this.activeStep.set(3);
  }

  searchProtectedCoins(event: { query: string }): void {
    const coins = this.coinsQuery.data();
    if (!coins) {
      this.protectedCoinSuggestions.set([]);
      return;
    }
    const selectedSlugs = new Set(this.protectedCoins().map((c) => c.slug));
    this.protectedCoinSuggestions.set(filterCoinSuggestions(coins, event.query, selectedSlugs));
  }

  saveOpportunitySelling(): void {
    const payload: Partial<OpportunitySellingUserConfig> & { enabled?: boolean } = {
      enabled: this.opportunitySellingEnabled(),
      protectedCoins: this.protectedCoins().map((c) => c.slug),
      maxLiquidationPercent: Math.min(100, Math.max(1, this.maxLiquidationPercent()))
    };

    this.updateOpportunitySellingMutation.mutate(payload, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Saved',
          detail: 'Opportunity selling configuration saved'
        });
        this.completed.emit();
      },
      onError: (error: Error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: error?.message || 'Failed to save configuration'
        });
      }
    });
  }
}
