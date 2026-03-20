import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';

import { ConfirmationService, MessageService } from 'primeng/api';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { PanelModule } from 'primeng/panel';
import { SkeletonModule } from 'primeng/skeleton';
import { SliderModule } from 'primeng/slider';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { Coin, Exchange, ExchangeKey } from '@chansey/api-interfaces';

import { RiskProfileFormComponent } from '../../../../../shared/components/risk-profile-form/risk-profile-form.component';
import { AuthService } from '../../../../../shared/services/auth.service';
import { ExchangeService } from '../../../../../shared/services/exchange.service';
import { ExchangeFormState } from '../../../../../shared/types/exchange-form.types';
import { filterCoinSuggestions } from '../../../../../shared/utils/coin-filter.util';
import { SettingsService } from '../../settings.service';
import { createAutoSave } from '../../utils/auto-save';
import { createPanelState } from '../../utils/panel-state';
import { ExchangeIntegrationsComponent } from '../exchange-integrations/exchange-integrations.component';
import { SaveStatusIndicatorComponent } from '../save-status-indicator/save-status-indicator.component';

@Component({
  selector: 'app-trading-settings',
  imports: [
    AutoCompleteModule,
    ButtonModule,
    ExchangeIntegrationsComponent,
    FormsModule,
    MessageModule,
    PanelModule,
    ReactiveFormsModule,
    RiskProfileFormComponent,
    SaveStatusIndicatorComponent,
    SkeletonModule,
    SliderModule,
    ToggleSwitchModule
  ],
  templateUrl: './trading-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TradingSettingsComponent {
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private settingsService = inject(SettingsService);
  private authService = inject(AuthService);
  private exchangeService = inject(ExchangeService);

  private readonly userQuery = this.authService.useUser();
  readonly coinsQuery = this.settingsService.useCoinsQuery();
  readonly opportunitySellingQuery = this.settingsService.useOpportunitySellingQuery();
  readonly updateOpportunitySellingMutation = this.settingsService.useUpdateOpportunitySellingMutation();
  readonly futuresTradingQuery = this.settingsService.useFuturesTradingQuery();
  readonly updateFuturesTradingMutation = this.settingsService.useUpdateFuturesTradingMutation();

  // Exchange integrations
  readonly supportedExchangesQuery = this.exchangeService.useSupportedExchanges();
  readonly saveExchangeKeysMutation = this.exchangeService.useSaveExchangeKeysMutation();
  readonly deleteExchangeKeyMutation = this.exchangeService.useDeleteExchangeKeyMutation();

  user = computed(() => this.userQuery.data());

  readonly futuresAutoSave = createAutoSave(() => this.doSaveFutures());
  readonly opportunityToggleAutoSave = createAutoSave(() => this.doSaveOpportunityToggle());

  private panelState = createPanelState('trading', [
    'riskProfile',
    'opportunitySelling',
    'opportunityConfig',
    'futuresTrading'
  ]);
  panelCollapsed = this.panelState.collapsed;
  onPanelToggle = this.panelState.onToggle;

  futuresEnabled = false;
  private pendingFuturesChecked = false;
  private pendingOpportunityChecked = false;
  protectedCoinSuggestions = signal<Coin[]>([]);
  private opportunitySellingInitialized = false;

  opportunitySellingForm = new FormGroup({
    enabled: new FormControl(false),
    protectedCoins: new FormControl<Coin[]>([]),
    maxLiquidationPercent: new FormControl(30)
  });

  hasFuturesCapableExchange = computed(() => {
    const user = this.userQuery.data();
    return !!user?.exchanges?.some((ex) => ex.supportsFutures);
  });

  // Exchange forms
  exchangeForms = signal<Record<string, ExchangeFormState>>({});

  constructor() {
    // Opportunity selling init
    effect(() => {
      const data = this.opportunitySellingQuery.data();
      const coins = this.coinsQuery.data();
      if (data && coins && !this.opportunitySellingInitialized) {
        this.opportunitySellingInitialized = true;
        const protectedCoinObjects = data.config.protectedCoins
          .map((slug) => coins.find((c) => c.slug === slug))
          .filter((c): c is Coin => !!c);
        this.opportunitySellingForm.patchValue(
          {
            enabled: data.enabled,
            protectedCoins: protectedCoinObjects,
            maxLiquidationPercent: data.config.maxLiquidationPercent
          },
          { emitEvent: false }
        );
      }
    });

    effect(() => {
      const data = this.futuresTradingQuery.data();
      if (data) {
        this.futuresEnabled = data.futuresEnabled;
      }
    });

    // Build exchange forms when exchanges + user data are available
    effect(() => {
      const exchanges = this.supportedExchangesQuery.data();
      const userData = this.user();
      if (!exchanges || !userData) return;

      const built = this.exchangeService.buildExchangeForms(
        exchanges,
        userData,
        untracked(() => this.exchangeForms())
      );
      // For settings page, also sync form enable/disable state for non-edit forms
      for (const slug of Object.keys(built)) {
        const state = built[slug];
        if (!state.editMode) {
          const apiKey = state.form.get('apiKey');
          const secretKey = state.form.get('secretKey');
          if (apiKey && secretKey) {
            if (state.connected) {
              apiKey.disable();
              secretKey.disable();
              state.form.patchValue({ apiKey: '••••••••••••••••••••••••', secretKey: '••••••••••••••••••••••••' });
            } else {
              apiKey.enable();
              secretKey.enable();
            }
          }
        }
      }
      this.exchangeForms.set(built);
    });
  }

  // --- Opportunity Selling ---

  searchProtectedCoins(event: { query: string }): void {
    const coins = this.coinsQuery.data();
    if (!coins) {
      this.protectedCoinSuggestions.set([]);
      return;
    }
    const selected: Coin[] = this.opportunitySellingForm.get('protectedCoins')?.value ?? [];
    const selectedSlugs = new Set(selected.map((c) => c.slug));
    this.protectedCoinSuggestions.set(filterCoinSuggestions(coins, event.query, selectedSlugs));
  }

  toggleFuturesTrading(event: { checked: boolean }): void {
    this.pendingFuturesChecked = event.checked;
    this.futuresAutoSave.trigger();
  }

  toggleOpportunitySelling(event: { checked: boolean }): void {
    this.pendingOpportunityChecked = event.checked;
    this.opportunityToggleAutoSave.trigger();
  }

  private doSaveFutures(): void {
    const checked = this.pendingFuturesChecked;
    this.updateFuturesTradingMutation.mutate(
      { enabled: checked },
      {
        onSuccess: () => {
          this.futuresAutoSave.markSaved();
        },
        onError: (error: Error) => {
          this.futuresEnabled = !checked;
          this.futuresAutoSave.markError();
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error?.message || 'Failed to update futures trading'
          });
        }
      }
    );
  }

  private doSaveOpportunityToggle(): void {
    const checked = this.pendingOpportunityChecked;
    this.updateOpportunitySellingMutation.mutate(
      { enabled: checked },
      {
        onSuccess: () => {
          this.opportunityToggleAutoSave.markSaved();
        },
        onError: (error: Error) => {
          this.opportunitySellingForm.get('enabled')?.setValue(!checked, { emitEvent: false });
          this.opportunityToggleAutoSave.markError();
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error?.message || 'Failed to update opportunity selling'
          });
        }
      }
    );
  }

  saveOpportunitySelling(): void {
    const currentData = this.opportunitySellingQuery.data();
    if (!currentData) return;

    const formValues = this.opportunitySellingForm.value;
    const payload: Record<string, unknown> = {};

    const protectedSlugs: string[] = (formValues.protectedCoins ?? []).map((c: Coin) => c.slug);
    const currentSet = new Set(currentData.config.protectedCoins);
    if (protectedSlugs.length !== currentSet.size || !protectedSlugs.every((slug) => currentSet.has(slug))) {
      payload['protectedCoins'] = protectedSlugs;
    }
    if (formValues.maxLiquidationPercent !== currentData.config.maxLiquidationPercent) {
      payload['maxLiquidationPercent'] = formValues.maxLiquidationPercent;
    }

    if (Object.keys(payload).length === 0) {
      this.messageService.add({
        severity: 'info',
        summary: 'No Changes',
        detail: 'No configuration changes detected'
      });
      return;
    }

    this.updateOpportunitySellingMutation.mutate(payload, {
      onSuccess: () => {
        this.opportunitySellingInitialized = false;
        this.messageService.add({
          severity: 'success',
          summary: 'Saved',
          detail: 'Opportunity selling configuration updated'
        });
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

  // --- Exchange Key handlers ---

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

    if (exchange.editMode) {
      const userData = this.user();
      const existingKey = userData?.exchanges?.find((ex: ExchangeKey) => ex.exchangeId === exchangeObj.id);
      if (!existingKey?.id) {
        this.messageService.add({
          severity: 'error',
          summary: 'Update Failed',
          detail: `Could not find existing keys for ${exchangeObj.name}.`
        });
        this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { loading: false });
        return;
      }

      this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { loading: false });
      this.confirmationService.confirm({
        message:
          "Updating exchange keys will briefly disconnect your exchange. If the new keys fail validation, you'll need to re-enter them.",
        header: 'Update Exchange Keys',
        icon: 'pi pi-exclamation-triangle',
        accept: () => {
          this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { loading: true });
          this.deleteExchangeKeyMutation.mutate(existingKey.id, {
            onSuccess: () =>
              this.exchangeService.saveNewExchangeKey({
                mutation: this.saveExchangeKeysMutation,
                exchangeObj,
                formData,
                formsSignal: this.exchangeForms,
                messageService: this.messageService
              }),
            onError: (error: Error & { error?: { message?: string } }) => {
              this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { loading: false });
              this.messageService.add({
                severity: 'error',
                summary: 'Update Failed',
                detail:
                  error.error?.message || `Failed to remove existing keys for ${exchangeObj.name}. Please try again.`
              });
            }
          });
        },
        reject: () => {
          this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { loading: false });
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

  onEditExchangeKeys(exchangeSlug: string): void {
    const forms = this.exchangeForms();
    const exchange = forms[exchangeSlug];
    if (!exchange) return;

    const apiKey = exchange.form.get('apiKey');
    const secretKey = exchange.form.get('secretKey');
    if (apiKey && secretKey) {
      apiKey.enable();
      secretKey.enable();
      exchange.form.patchValue({ apiKey: '', secretKey: '' });
    }
    this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { editMode: true });
  }

  onCancelEditExchangeKeys(exchangeSlug: string): void {
    const forms = this.exchangeForms();
    const exchange = forms[exchangeSlug];
    if (!exchange) return;

    const userData = this.user();
    const exchangeObj = this.supportedExchangesQuery.data()?.find((ex: Exchange) => ex.slug === exchangeSlug);
    const isConnected = !!userData?.exchanges?.find((key: ExchangeKey) => key.exchangeId === exchangeObj?.id);

    const apiKey = exchange.form.get('apiKey');
    const secretKey = exchange.form.get('secretKey');
    if (apiKey && secretKey) {
      exchange.form.patchValue({
        apiKey: isConnected ? '••••••••••••••••••••••••' : '',
        secretKey: isConnected ? '••••••••••••••••••••••••' : ''
      });
      apiKey.disable();
      secretKey.disable();
    }
    this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { editMode: false, submitted: false });
  }

  onRemoveExchangeKeys(exchangeSlug: string): void {
    const forms = this.exchangeForms();
    const exchange = forms[exchangeSlug];
    if (!exchange) return;

    const exchangeObj = this.supportedExchangesQuery.data()?.find((ex: Exchange) => ex.slug === exchangeSlug);
    const exchangeName = exchangeObj?.name || exchangeSlug;

    this.confirmationService.confirm({
      message: `Are you sure you want to disconnect your ${exchangeName} account? This will remove your API keys.`,
      header: 'Disconnect Exchange',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { loading: true });
        const userData = this.user();
        const exchangeKeyData = userData?.exchanges?.find((ex: ExchangeKey) => ex.exchangeId === exchangeObj?.id);

        if (!exchangeKeyData?.id) {
          this.messageService.add({
            severity: 'error',
            summary: 'Disconnection Failed',
            detail: `Could not find exchange key for ${exchangeName}.`
          });
          this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { loading: false });
          return;
        }

        this.deleteExchangeKeyMutation.mutate(exchangeKeyData.id, {
          onSuccess: () => {
            this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, {
              connected: false,
              loading: false
            });
            const form = this.exchangeForms()[exchangeSlug]?.form;
            const apiKey = form?.get('apiKey');
            const secretKey = form?.get('secretKey');
            if (apiKey && secretKey) {
              apiKey.enable();
              secretKey.enable();
              form.patchValue({ apiKey: '', secretKey: '' });
            }
            this.messageService.add({
              severity: 'success',
              summary: 'Exchange Disconnected',
              detail: `Your ${exchangeName} account has been disconnected successfully`
            });
          },
          onError: (error: Error & { error?: { message?: string } }) => {
            this.exchangeService.updateExchangeForm(this.exchangeForms, exchangeSlug, { loading: false });
            this.messageService.add({
              severity: 'error',
              summary: 'Disconnection Failed',
              detail: error.error?.message || `Failed to disconnect ${exchangeName}. Please try again.`
            });
          }
        });
      }
    });
  }
}
