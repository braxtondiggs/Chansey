import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

import { ConfirmationService, MessageService } from 'primeng/api';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { FloatLabel } from 'primeng/floatlabel';
import { PanelModule } from 'primeng/panel';
import { ProgressBar } from 'primeng/progressbar';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { SliderModule } from 'primeng/slider';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import {
  Coin,
  Exchange,
  ExchangeKey,
  Risk,
  TRADING_STYLE_PROFILES,
  TradingStyleProfile
} from '@chansey/api-interfaces';

import { AuthService } from '../../../../../shared/services/auth.service';
import { ExchangeService } from '../../../../../shared/services/exchange.service';
import { RisksService } from '../../../../admin/risks/risks.service';
import { SettingsService } from '../../settings.service';
import { ExchangeFormState } from '../../settings.types';
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
    FloatLabel,
    FormsModule,
    PanelModule,
    ProgressBar,
    ReactiveFormsModule,
    SaveStatusIndicatorComponent,
    SelectModule,
    SkeletonModule,
    SliderModule,
    ToggleSwitchModule
  ],
  templateUrl: './trading-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TradingSettingsComponent {
  private fb = inject(FormBuilder);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private settingsService = inject(SettingsService);
  private authService = inject(AuthService);
  private riskService = inject(RisksService);
  private exchangeService = inject(ExchangeService);

  private readonly userQuery = this.authService.useUser();
  readonly coinsQuery = this.settingsService.useCoinsQuery();
  readonly opportunitySellingQuery = this.settingsService.useOpportunitySellingQuery();
  readonly updateOpportunitySellingMutation = this.settingsService.useUpdateOpportunitySellingMutation();
  readonly futuresTradingQuery = this.settingsService.useFuturesTradingQuery();
  readonly updateFuturesTradingMutation = this.settingsService.useUpdateFuturesTradingMutation();

  // Risk profile
  readonly risksQuery = this.riskService.useRisks();
  readonly updateProfileMutation = this.settingsService.useUpdateProfileMutation();

  // Exchange integrations
  readonly supportedExchangesQuery = this.exchangeService.useSupportedExchanges();
  readonly saveExchangeKeysMutation = this.settingsService.useSaveExchangeKeysMutation();
  readonly deleteExchangeKeyMutation = this.settingsService.useDeleteExchangeKeyMutation();

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
  protectedCoinSuggestions: Coin[] = [];
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

  // Risk profile form
  riskForm: FormGroup = this.fb.group({
    coinRisk: ['', Validators.required],
    calculationRiskLevel: [null]
  });

  calculationRiskOptions = [
    { label: 'Ultra Conservative', value: 1 },
    { label: 'Conservative', value: 2 },
    { label: 'Moderate', value: 3 },
    { label: 'Growth', value: 4 },
    { label: 'Aggressive', value: 5 }
  ];

  selectedCoinRiskId = signal<string | null>(null);
  selectedCalcRiskLevel = signal<number | null>(null);

  readonly DAILY_LOSS_LIMIT_SCALE = 5;
  readonly BEAR_MARKET_CAPITAL_SCALE = 4;

  tradingStyleProfile = computed<TradingStyleProfile | null>(() => {
    const calcRisk = this.selectedCalcRiskLevel();
    const risks = this.risksQuery.data();
    const selectedId = this.selectedCoinRiskId();
    if (!risks || !selectedId) return null;
    const selected = risks.find((r: Risk) => r.id === selectedId);
    if (!selected) return null;
    const level = calcRisk ?? selected.level;
    return TRADING_STYLE_PROFILES[level] ?? TRADING_STYLE_PROFILES[3];
  });

  // Exchange forms
  exchangeForms = signal<Record<string, ExchangeFormState>>({});

  constructor() {
    // Risk form subscriptions
    this.riskForm
      .get('coinRisk')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((v) => {
        this.selectedCoinRiskId.set(v);
        const risks = this.risksQuery.data();
        const selected = risks?.find((r: Risk) => r.id === v);
        if (selected && selected.level >= 1 && selected.level <= 5) {
          this.riskForm.get('calculationRiskLevel')?.setValue(selected.level);
        }
      });
    this.riskForm
      .get('calculationRiskLevel')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((v) => this.selectedCalcRiskLevel.set(v));

    // Populate risk form from user data
    effect(() => {
      const userData = this.user();
      if (userData && !this.riskForm.dirty) {
        const coinRiskObj = userData.coinRisk;
        const calcLevel = userData.calculationRiskLevel ?? coinRiskObj?.level ?? null;
        this.riskForm.patchValue({
          coinRisk: coinRiskObj?.id || '',
          calculationRiskLevel: calcLevel
        });
        this.selectedCoinRiskId.set(coinRiskObj?.id || null);
        this.selectedCalcRiskLevel.set(calcLevel);
      }
    });

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

      this.exchangeForms.update((current) => {
        const updated = { ...current };
        exchanges.forEach((exchange: Exchange) => {
          const slug = exchange.slug;
          const matchedKey = userData.exchanges?.find((key: ExchangeKey) => key.exchangeId === exchange.id);
          const isConnected = !!matchedKey;

          if (updated[slug]) {
            if (!updated[slug].editMode) {
              updated[slug] = { ...updated[slug], connected: isConnected, connectedAt: matchedKey?.createdAt };
              const form = updated[slug].form;
              const apiKey = form.get('apiKey');
              const secretKey = form.get('secretKey');
              if (apiKey && secretKey) {
                if (isConnected) {
                  apiKey.disable();
                  secretKey.disable();
                  form.patchValue({ apiKey: '••••••••••••••••••••••••', secretKey: '••••••••••••••••••••••••' });
                } else {
                  apiKey.enable();
                  secretKey.enable();
                }
              }
            }
          } else {
            updated[slug] = {
              form: this.fb.nonNullable.group({
                apiKey: [
                  { value: isConnected ? '••••••••••••••••••••••••' : '', disabled: isConnected },
                  Validators.required
                ],
                secretKey: [
                  { value: isConnected ? '••••••••••••••••••••••••' : '', disabled: isConnected },
                  Validators.required
                ]
              }),
              connected: isConnected,
              loading: false,
              submitted: false,
              editMode: false,
              name: exchange.name,
              exchangeId: exchange.id,
              slug,
              connectedAt: matchedKey?.createdAt
            };
          }
        });
        return updated;
      });
    });
  }

  // --- Opportunity Selling ---

  searchProtectedCoins(event: { query: string }): void {
    const coins = this.coinsQuery.data();
    if (!coins) {
      this.protectedCoinSuggestions = [];
      return;
    }
    const query = event.query.toLowerCase();
    const selected: Coin[] = this.opportunitySellingForm.get('protectedCoins')?.value ?? [];
    const selectedSlugs = new Set(selected.map((c) => c.slug));
    this.protectedCoinSuggestions = coins
      .filter(
        (c) =>
          !selectedSlugs.has(c.slug) && (c.name.toLowerCase().includes(query) || c.symbol.toLowerCase().includes(query))
      )
      .slice(0, 10);
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

  // --- Risk Profile ---

  saveRiskProfile(): void {
    if (!this.riskForm.valid || !this.riskForm.dirty) return;

    const formData = this.riskForm.getRawValue();
    const userData = this.user();
    const updatedFields: Record<string, unknown> = {};

    if (userData) {
      const coinRiskObj = userData.coinRisk;
      if (formData.coinRisk !== (coinRiskObj?.id || '')) {
        updatedFields['coinRisk'] = formData.coinRisk;
      }
      const currentCalcLevel = userData.calculationRiskLevel ?? coinRiskObj?.level ?? null;
      if (formData.calculationRiskLevel !== currentCalcLevel) {
        updatedFields['calculationRiskLevel'] = formData.calculationRiskLevel;
      }
    }

    if (Object.keys(updatedFields).length === 0) {
      this.messageService.add({
        severity: 'info',
        summary: 'No Changes',
        detail: 'No risk profile changes detected'
      });
      return;
    }

    this.updateProfileMutation.mutate(updatedFields, {
      onSuccess: () => {
        this.riskForm.markAsPristine();
        this.messageService.add({
          severity: 'success',
          summary: 'Risk Profile Updated',
          detail: 'Your risk profile has been updated successfully'
        });
      },
      onError: (error: Error & { message?: string }) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Update Failed',
          detail: error?.message || 'Failed to update risk profile. Please try again.'
        });
      }
    });
  }

  // --- Exchange Key handlers ---

  onSaveExchangeKeys(exchangeSlug: string): void {
    const forms = this.exchangeForms();
    const exchange = forms[exchangeSlug];
    if (!exchange) return;

    this.updateExchangeForm(exchangeSlug, { submitted: true });
    if (!exchange.form.valid) return;

    this.updateExchangeForm(exchangeSlug, { loading: true });
    const formData = exchange.form.getRawValue();

    const exchangeObj = this.supportedExchangesQuery.data()?.find((ex: Exchange) => ex.slug === exchangeSlug);
    if (!exchangeObj) {
      this.messageService.add({
        severity: 'error',
        summary: 'Connection Failed',
        detail: `Could not find exchange with key: ${exchangeSlug}`
      });
      this.updateExchangeForm(exchangeSlug, { loading: false });
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
        this.updateExchangeForm(exchangeSlug, { loading: false });
        return;
      }

      this.updateExchangeForm(exchangeSlug, { loading: false });
      this.confirmationService.confirm({
        message:
          "Updating exchange keys will briefly disconnect your exchange. If the new keys fail validation, you'll need to re-enter them.",
        header: 'Update Exchange Keys',
        icon: 'pi pi-exclamation-triangle',
        accept: () => {
          this.updateExchangeForm(exchangeSlug, { loading: true });
          this.deleteExchangeKeyMutation.mutate(existingKey.id, {
            onSuccess: () => this.addNewExchangeKey(exchangeSlug, exchangeObj, formData),
            onError: (error: Error & { error?: { message?: string } }) => {
              this.updateExchangeForm(exchangeSlug, { loading: false });
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
          this.updateExchangeForm(exchangeSlug, { loading: false });
        }
      });
    } else {
      this.addNewExchangeKey(exchangeSlug, exchangeObj, formData);
    }
  }

  private addNewExchangeKey(
    exchangeSlug: string,
    exchangeObj: Exchange,
    formData: { apiKey: string; secretKey: string }
  ): void {
    const exchangeKeyDto = {
      exchangeId: exchangeObj.id,
      apiKey: formData.apiKey,
      secretKey: formData.secretKey,
      isActive: true
    };

    this.saveExchangeKeysMutation.mutate(exchangeKeyDto, {
      onSuccess: ({ isActive }) => {
        this.updateExchangeForm(exchangeSlug, { connected: true, loading: false, editMode: false });
        this.messageService.add({
          severity: isActive ? 'success' : 'error',
          summary: isActive ? 'Connection Successful' : 'Connection Failed',
          detail: isActive
            ? `Your ${exchangeObj.name} account has been connected successfully`
            : `Failed to connect to ${exchangeObj.name}. Please check your API keys and try again.`
        });
      },
      onError: (error: Error & { status?: number; error?: { message?: string } }) => {
        this.updateExchangeForm(exchangeSlug, { loading: false });
        const detail =
          error.status === 409
            ? 'You already have API keys for this exchange. Please remove the existing keys before adding new ones.'
            : error.error?.message ||
              `Failed to connect to ${exchangeObj.name}. Please check your API keys and try again.`;
        this.messageService.add({ severity: 'error', summary: 'Connection Failed', detail });
      }
    });
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
    this.updateExchangeForm(exchangeSlug, { editMode: true });
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
    this.updateExchangeForm(exchangeSlug, { editMode: false, submitted: false });
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
        this.updateExchangeForm(exchangeSlug, { loading: true });
        const userData = this.user();
        const exchangeKeyData = userData?.exchanges?.find((ex: ExchangeKey) => ex.exchangeId === exchangeObj?.id);

        if (!exchangeKeyData?.id) {
          this.messageService.add({
            severity: 'error',
            summary: 'Disconnection Failed',
            detail: `Could not find exchange key for ${exchangeName}.`
          });
          this.updateExchangeForm(exchangeSlug, { loading: false });
          return;
        }

        this.deleteExchangeKeyMutation.mutate(exchangeKeyData.id, {
          onSuccess: () => {
            this.updateExchangeForm(exchangeSlug, { connected: false, loading: false });
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
            this.updateExchangeForm(exchangeSlug, { loading: false });
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

  private updateExchangeForm(slug: string, updates: Partial<ExchangeFormState>): void {
    this.exchangeForms.update((current) => {
      if (!current[slug]) return current;
      return { ...current, [slug]: { ...current[slug], ...updates } };
    });
  }
}
