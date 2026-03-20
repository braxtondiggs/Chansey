import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { MessageService } from 'primeng/api';
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

import {
  Coin,
  CoinSelectionType,
  CUSTOM_RISK_LEVEL,
  MIN_TRADING_COINS,
  Risk,
  TRADING_STYLE_PROFILES,
  TradingStyleProfile
} from '@chansey/api-interfaces';

import { RisksService } from '../../../pages/admin/risks/risks.service';
import { SettingsService } from '../../../pages/user/settings/settings.service';
import { AuthService } from '../../services/auth.service';
import { CoinDataService } from '../../services/coin-data.service';
import { filterCoinSuggestions } from '../../utils/coin-filter.util';

/** Human-readable descriptions of coin selection criteria per risk level */
const RISK_CRITERIA: Record<number, string> = {
  1: 'High-volume, established coins with stable track records',
  2: 'Balanced selection favoring stability over growth',
  3: 'Mix of established and emerging coins',
  4: 'Growth-oriented coins with higher potential',
  5: 'Top-ranked trending coins for maximum growth'
};

const DAILY_LOSS_LIMIT_SCALE = 5;
const BEAR_MARKET_CAPITAL_SCALE = 4;

@Component({
  selector: 'app-risk-profile-form',
  imports: [
    AutoCompleteModule,
    ButtonModule,
    ChipModule,
    FloatLabel,
    FormsModule,
    MessageModule,
    PanelModule,
    ProgressBar,
    ReactiveFormsModule,
    RouterLink,
    SelectButtonModule,
    SelectModule,
    SkeletonModule
  ],
  templateUrl: './risk-profile-form.component.html',
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
export class RiskProfileFormComponent {
  private fb = inject(FormBuilder);
  private messageService = inject(MessageService);
  private authService = inject(AuthService);
  private coinDataService = inject(CoinDataService);
  private riskService = inject(RisksService);
  private settingsService = inject(SettingsService);

  /** Whether to show the trading coins autocomplete in manual mode */
  showTradingCoins = input(true);

  /** Whether the Risk Summary panel is collapsible */
  collapsible = input(true);

  /** When true, the save button is enabled even with no changes (emits saved immediately) */
  alwaysAllowSave = input(false);

  /** Label for the save button */
  saveButtonLabel = input('Save Risk Profile');

  /** Emitted after a successful save */
  saved = output<void>();

  private readonly userQuery = this.authService.useUser();
  readonly coinsQuery = this.settingsService.useCoinsQuery();
  readonly risksQuery = this.riskService.useRisks();
  readonly updateProfileMutation = this.settingsService.useUpdateProfileMutation();

  // Trading coins (conditionally used when showTradingCoins)
  readonly tradingCoinsQuery = this.coinDataService.useTradingCoins();
  readonly addToTradingMutation = this.coinDataService.useAddToTradingCoins();
  readonly removeFromTradingMutation = this.coinDataService.useRemoveFromTradingCoins();

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
  tradingCoinSuggestions = signal<Coin[]>([]);

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

  // Risk profile form
  riskForm = this.fb.group({
    coinRisk: ['', Validators.required],
    calculationRiskLevel: [null as number | null]
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

  readonly DAILY_LOSS_LIMIT_SCALE = DAILY_LOSS_LIMIT_SCALE;
  readonly BEAR_MARKET_CAPITAL_SCALE = BEAR_MARKET_CAPITAL_SCALE;

  tradingStyleProfile = computed<TradingStyleProfile | null>(() => {
    const calcRisk = this.selectedCalcRiskLevel();
    if (calcRisk) return TRADING_STYLE_PROFILES[calcRisk] ?? TRADING_STYLE_PROFILES[3];
    const risks = this.risksQuery.data();
    const selectedId = this.selectedCoinRiskId();
    if (!risks || !selectedId) return null;
    const selected = risks.find((r: Risk) => r.id === selectedId);
    if (!selected) return null;
    return TRADING_STYLE_PROFILES[selected.level] ?? TRADING_STYLE_PROFILES[3];
  });

  getCriteriaDescription(level: number): string {
    return RISK_CRITERIA[level] ?? '';
  }

  constructor() {
    // Risk form subscriptions
    this.riskForm
      .get('coinRisk')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((v) => {
        this.selectedCoinRiskId.set(v);
      });
    this.riskForm
      .get('calculationRiskLevel')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((v) => {
        this.selectedCalcRiskLevel.set(v);
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

        this.coinSelectionMode.set(coinRiskObj?.level === CUSTOM_RISK_LEVEL ? 'manual' : 'auto');

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
  }

  // --- Coin Selection Mode ---

  onModeChange(mode: 'auto' | 'manual'): void {
    this.coinSelectionMode.set(mode);
    this.riskForm.markAsDirty();
    if (mode === 'manual') {
      const level6 = this.level6Risk();
      if (level6) {
        this.riskForm.get('coinRisk')?.setValue(level6.id);
      }
    } else {
      const userData = this.user();
      const savedRisk = userData?.coinRisk;
      const fallback = savedRisk?.level !== CUSTOM_RISK_LEVEL ? savedRisk : null;
      const restoreRisk = fallback ?? this.autoRisks().find((r) => r.level === 3);
      if (restoreRisk) {
        this.riskForm.get('coinRisk')?.setValue(restoreRisk.id);
      }
    }
  }

  searchTradingCoins(event: { query: string }): void {
    const coins = this.coinsQuery.data();
    if (!coins) {
      this.tradingCoinSuggestions.set([]);
      return;
    }
    const tradingSlugs = new Set(this.tradingCoinItems().map((w) => w.coin.slug));
    this.tradingCoinSuggestions.set(filterCoinSuggestions(coins, event.query, tradingSlugs));
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

  // --- Save ---

  saveRiskProfile(): void {
    if (!this.riskForm.valid || this.manualModeBlocked()) return;
    if (!this.hasRiskChanges()) {
      if (this.alwaysAllowSave()) {
        this.saved.emit();
      }
      return;
    }

    const formData = this.riskForm.getRawValue();
    const userData = this.user();
    const updatedFields: Record<string, unknown> = {};

    if (userData) {
      const coinRiskObj = userData.coinRisk;
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
        this.saved.emit();
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
}
