import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ConfirmationService, MessageService } from 'primeng/api';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { ChipModule } from 'primeng/chip';
import { FloatLabel } from 'primeng/floatlabel';
import { MessageModule } from 'primeng/message';
import { PanelModule } from 'primeng/panel';
import { ProgressBar } from 'primeng/progressbar';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { SkeletonModule } from 'primeng/skeleton';
import { SliderModule } from 'primeng/slider';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import {
  Coin,
  CoinSelectionType,
  CUSTOM_RISK_LEVEL,
  Exchange,
  ExchangeKey,
  MIN_TRADING_COINS,
  Risk,
  TRADING_STYLE_PROFILES,
  TradingStyleProfile
} from '@chansey/api-interfaces';

/** Human-readable descriptions of coin selection criteria per risk level */
const RISK_CRITERIA: Record<number, string> = {
  1: 'High-volume, established coins with stable track records',
  2: 'Balanced selection favoring stability over growth',
  3: 'Mix of established and emerging coins',
  4: 'Growth-oriented coins with higher potential',
  5: 'Top-ranked trending coins for maximum growth'
};

import { AuthService } from '../../../../../shared/services/auth.service';
import { CoinDataService } from '../../../../../shared/services/coin-data.service';
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
    ChipModule,
    ExchangeIntegrationsComponent,
    FloatLabel,
    FormsModule,
    MessageModule,
    PanelModule,
    ProgressBar,
    ReactiveFormsModule,
    RouterLink,
    SaveStatusIndicatorComponent,
    SelectButtonModule,
    SelectModule,
    SkeletonModule,
    SliderModule,
    ToggleSwitchModule
  ],
  templateUrl: './trading-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    ::ng-deep .coin-selection-toggle .p-togglebutton-checked {
      background: var(--p-primary-color) !important;
      border-color: var(--p-primary-color) !important;
    }
    ::ng-deep .coin-selection-toggle .p-togglebutton-checked .p-togglebutton-content {
      background: transparent !important;
      color: var(--p-primary-contrast-color) !important;
    }
    ::ng-deep .trading-coins-autocomplete .p-autocomplete-chip {
      background: var(--p-primary-color) !important;
      border-color: var(--p-primary-color) !important;
    }
    ::ng-deep .trading-coins-autocomplete .p-autocomplete-chip .p-chip-label,
    ::ng-deep .trading-coins-autocomplete .p-autocomplete-chip .p-chip-remove-icon {
      color: var(--p-primary-contrast-color) !important;
    }
  `
})
export class TradingSettingsComponent {
  private fb = inject(FormBuilder);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private settingsService = inject(SettingsService);
  private authService = inject(AuthService);
  private coinDataService = inject(CoinDataService);
  private riskService = inject(RisksService);
  private exchangeService = inject(ExchangeService);

  private readonly userQuery = this.authService.useUser();
  readonly coinsQuery = this.settingsService.useCoinsQuery();
  readonly opportunitySellingQuery = this.settingsService.useOpportunitySellingQuery();
  readonly updateOpportunitySellingMutation = this.settingsService.useUpdateOpportunitySellingMutation();
  readonly futuresTradingQuery = this.settingsService.useFuturesTradingQuery();
  readonly updateFuturesTradingMutation = this.settingsService.useUpdateFuturesTradingMutation();

  // Trading coins
  readonly tradingCoinsQuery = this.coinDataService.useTradingCoins();
  readonly addToTradingMutation = this.coinDataService.useAddToTradingCoins();
  readonly removeFromTradingMutation = this.coinDataService.useRemoveFromTradingCoins();

  // Risk profile
  readonly risksQuery = this.riskService.useRisks();
  readonly updateProfileMutation = this.settingsService.useUpdateProfileMutation();

  // Exchange integrations
  readonly supportedExchangesQuery = this.exchangeService.useSupportedExchanges();
  readonly saveExchangeKeysMutation = this.settingsService.useSaveExchangeKeysMutation();
  readonly deleteExchangeKeyMutation = this.settingsService.useDeleteExchangeKeyMutation();

  user = computed(() => this.userQuery.data());

  // Coin selection mode
  coinSelectionMode = signal<'auto' | 'manual'>('auto');
  readonly coinSelectionOptions = [
    { label: 'Pick for me', value: 'auto' },
    { label: "I'll choose my own", value: 'manual' }
  ];

  level6Risk = computed(() => this.risksQuery.data()?.find((r) => r.level === CUSTOM_RISK_LEVEL) ?? null);
  autoRisks = computed(() => this.risksQuery.data()?.filter((r) => r.level >= 1 && r.level <= 5) ?? []);

  /** Track selected auto-risk level for preview (null when in manual mode) */
  previewRiskLevel = signal<number | null>(null);
  readonly coinPreviewQuery = this.coinDataService.useCoinPreview(this.previewRiskLevel);
  previewCoins = computed(() => (this.coinSelectionMode() === 'auto' ? (this.coinPreviewQuery.data() ?? []) : []));
  tradingCoinItems = computed(() => this.tradingCoinsQuery.data() ?? []);
  /** Tracks pending add/remove coin IDs to handle race between mutation settlement and query refetch */
  private pendingTradingAdds = signal<Set<string>>(new Set());
  private pendingTradingRemoves = signal<Set<string>>(new Set());
  /** Count includes pending adds not yet in query data, excludes pending removes still in query data */
  tradingCoinCount = computed(() => {
    const queryData = this.tradingCoinsQuery.data() ?? [];
    const actualIds = new Set(queryData.map((w) => w.coin.id));
    const pendingAddsNotInData = [...this.pendingTradingAdds()].filter((id) => !actualIds.has(id)).length;
    const pendingRemovesStillInData = [...this.pendingTradingRemoves()].filter((id) => actualIds.has(id)).length;
    return queryData.length + pendingAddsNotInData - pendingRemovesStillInData;
  });

  tradingCoinObjects = computed(() => this.tradingCoinItems().map((w) => w.coin));
  tradingCoinSuggestions: Coin[] = [];

  readonly MIN_TRADING_COINS = MIN_TRADING_COINS;

  /** True when form values differ from saved user data */
  hasRiskChanges = computed(() => {
    const userData = this.user();
    if (!userData) return false;
    const coinRiskId = this.selectedCoinRiskId();
    const calcLevel = this.selectedCalcRiskLevel();
    const savedCoinRiskId = userData.coinRisk?.id || '';
    const savedCalcLevel = userData.calculationRiskLevel ?? userData.coinRisk?.level ?? null;
    const savedMode = userData.coinRisk?.level === CUSTOM_RISK_LEVEL ? 'manual' : 'auto';
    const modeChanged = this.coinSelectionMode() !== savedMode;
    return modeChanged || coinRiskId !== savedCoinRiskId || calcLevel !== savedCalcLevel;
  });

  /** True when manual mode is selected but trading coins fewer than required */
  manualModeBlocked = computed(
    () => this.coinSelectionMode() === 'manual' && this.tradingCoinCount() < MIN_TRADING_COINS
  );

  /** How many more coins the user needs to add */
  coinsNeeded = computed(() => Math.max(0, MIN_TRADING_COINS - this.tradingCoinCount()));

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
    { label: 'Conservative', value: 1, description: 'Minimal risk, smaller positions, tight loss limits' },
    { label: 'Moderately Conservative', value: 2, description: 'Low risk with slightly larger allocations' },
    { label: 'Moderate', value: 3, description: 'Balanced risk and position sizing' },
    { label: 'Moderately Aggressive', value: 4, description: 'Higher allocations, wider loss tolerance' },
    { label: 'Aggressive', value: 5, description: 'Maximum allocations, highest risk tolerance' }
  ];

  selectedCoinRiskId = signal<string | null>(null);
  selectedCalcRiskLevel = signal<number | null>(null);

  readonly DAILY_LOSS_LIMIT_SCALE = 5;
  readonly BEAR_MARKET_CAPITAL_SCALE = 4;

  tradingStyleProfile = computed<TradingStyleProfile | null>(() => {
    const calcRisk = this.selectedCalcRiskLevel();
    if (calcRisk) return TRADING_STYLE_PROFILES[calcRisk] ?? TRADING_STYLE_PROFILES[3];
    // Fallback: derive from coin risk level
    const risks = this.risksQuery.data();
    const selectedId = this.selectedCoinRiskId();
    if (!risks || !selectedId) return null;
    const selected = risks.find((r: Risk) => r.id === selectedId);
    if (!selected) return null;
    return TRADING_STYLE_PROFILES[selected.level] ?? TRADING_STYLE_PROFILES[3];
  });

  /** Get human-readable criteria description for a risk level */
  getCriteriaDescription(level: number): string {
    return RISK_CRITERIA[level] ?? '';
  }

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
      .subscribe((v) => {
        this.selectedCalcRiskLevel.set(v);
        // In auto mode, keep Auto-Select Coins in sync with Trading Style
        if (this.coinSelectionMode() === 'auto' && v >= 1 && v <= 5) {
          const matchingRisk = this.autoRisks().find((r) => r.level === v);
          if (matchingRisk && this.riskForm.get('coinRisk')?.value !== matchingRisk.id) {
            this.riskForm.get('coinRisk')?.setValue(matchingRisk.id);
          }
        }
      });

    // Populate risk form from user data
    effect(() => {
      const userData = this.user();
      if (userData && !this.riskForm.dirty) {
        const coinRiskObj = userData.coinRisk;
        const calcLevel = userData.calculationRiskLevel ?? coinRiskObj?.level ?? null;
        this.riskForm.patchValue(
          {
            coinRisk: coinRiskObj?.id || '',
            calculationRiskLevel: calcLevel
          },
          { emitEvent: false }
        );
        this.selectedCoinRiskId.set(coinRiskObj?.id || null);
        this.selectedCalcRiskLevel.set(calcLevel);

        // Detect coin selection mode from saved risk level
        this.coinSelectionMode.set(coinRiskObj?.level === CUSTOM_RISK_LEVEL ? 'manual' : 'auto');

        // Set preview level for auto mode
        if (coinRiskObj?.level !== CUSTOM_RISK_LEVEL && coinRiskObj?.level) {
          this.previewRiskLevel.set(coinRiskObj.level);
        }
      }
    });

    // Sync preview risk level when selection changes
    effect(() => {
      const selectedId = this.selectedCoinRiskId();
      const risks = this.risksQuery.data();
      const mode = this.coinSelectionMode();
      if (mode === 'auto' && selectedId && risks) {
        const risk = risks.find((r: Risk) => r.id === selectedId);
        if (risk && risk.level >= 1 && risk.level <= 5) {
          this.previewRiskLevel.set(risk.level);
        }
      } else if (mode === 'manual') {
        this.previewRiskLevel.set(null);
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

  // --- Coin Selection Mode ---

  onModeChange(mode: 'auto' | 'manual'): void {
    this.coinSelectionMode.set(mode);
    this.riskForm.markAsDirty(); // prevent user-data effect from overwriting
    if (mode === 'manual') {
      const level6 = this.level6Risk();
      if (level6) {
        this.riskForm.get('coinRisk')?.setValue(level6.id);
      }
    } else {
      const userData = this.user();
      const savedRisk = userData?.coinRisk;
      const savedCalcLevel = userData?.calculationRiskLevel;
      // In auto mode, both dropdowns must match — use calculationRiskLevel to pick the auto risk
      const matchingRisk = savedCalcLevel ? this.autoRisks().find((r) => r.level === savedCalcLevel) : null;
      const fallback = savedRisk?.level !== CUSTOM_RISK_LEVEL ? savedRisk : null;
      const restoreRisk = matchingRisk ?? fallback ?? this.autoRisks().find((r) => r.level === 3);
      if (restoreRisk) {
        this.riskForm.get('coinRisk')?.setValue(restoreRisk.id);
        // Subscription will auto-sync calculationRiskLevel to match
      }
    }
  }

  searchTradingCoins(event: { query: string }): void {
    const coins = this.coinsQuery.data();
    if (!coins) {
      this.tradingCoinSuggestions = [];
      return;
    }
    const query = event.query.toLowerCase();
    const tradingSlugs = new Set(this.tradingCoinItems().map((w) => w.coin.slug));
    this.tradingCoinSuggestions = coins
      .filter(
        (c) =>
          !tradingSlugs.has(c.slug) && (c.name.toLowerCase().includes(query) || c.symbol.toLowerCase().includes(query))
      )
      .slice(0, 10);
  }

  onTradingCoinSelect(event: { value: Coin }): void {
    const coin = event.value;
    if (!coin?.id) return;
    this.pendingTradingAdds.update((set) => new Set([...set, coin.id]));
    this.addToTradingMutation.mutate(
      { coinId: coin.id, type: CoinSelectionType.MANUAL },
      {
        onSettled: () =>
          this.pendingTradingAdds.update((set) => {
            const newSet = new Set(set);
            newSet.delete(coin.id);
            return newSet;
          })
      }
    );
  }

  onTradingCoinUnselect(event: { value: Coin }): void {
    const coin = event.value;
    if (!coin?.id) return;
    this.pendingTradingRemoves.update((set) => new Set([...set, coin.id]));
    const item = this.tradingCoinItems().find((w) => w.coin.id === coin.id);
    if (item) {
      this.removeFromTradingMutation.mutate(item.id, {
        onSettled: () =>
          this.pendingTradingRemoves.update((set) => {
            const newSet = new Set(set);
            newSet.delete(coin.id);
            return newSet;
          })
      });
    }
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
    if (!this.riskForm.valid || !this.hasRiskChanges() || this.manualModeBlocked()) return;

    const formData = this.riskForm.getRawValue();
    const userData = this.user();
    const updatedFields: Record<string, unknown> = {};

    if (userData) {
      const coinRiskObj = userData.coinRisk;
      // If switching to manual mode, ensure we send the level-6 risk ID
      if (this.coinSelectionMode() === 'manual') {
        const level6 = this.level6Risk();
        if (level6 && level6.id !== (coinRiskObj?.id || '')) {
          updatedFields['coinRisk'] = level6.id;
        }
      } else if (formData.coinRisk !== (coinRiskObj?.id || '')) {
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
