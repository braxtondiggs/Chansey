import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { startWith } from 'rxjs';

import { StopLossType, TakeProfitType, TickerPair, TrailingActivationType } from '@chansey/api-interfaces';

import {
  EXIT_CONFIG_LIMITS,
  EXIT_TRAILING_TYPE_OPTIONS,
  STOP_LOSS_TYPE_OPTIONS,
  TAKE_PROFIT_TYPE_OPTIONS,
  TRAILING_ACTIVATION_OPTIONS
} from '../../crypto-trading.constants';

@Component({
  selector: 'app-exit-config',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputNumberModule, SelectModule, ToggleSwitchModule, TooltipModule],
  templateUrl: './exit-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExitConfigComponent implements OnInit {
  form = input.required<FormGroup>();
  side = input.required<'BUY' | 'SELL'>();
  selectedPair = input.required<TickerPair | null>();

  isExpanded = signal(false);

  stopLossTypeOptions = STOP_LOSS_TYPE_OPTIONS;
  exitTrailingTypeOptions = EXIT_TRAILING_TYPE_OPTIONS;
  trailingActivationOptions = TRAILING_ACTIVATION_OPTIONS;

  readonly limits = EXIT_CONFIG_LIMITS;

  private readonly destroyRef = inject(DestroyRef);

  showOcoToggle(): boolean {
    const f = this.form();
    return !!f.get('enableStopLoss')?.value && !!f.get('enableTakeProfit')?.value;
  }

  isTrailingActivationImmediate(): boolean {
    return this.form().get('trailingActivation')?.value === TrailingActivationType.IMMEDIATE;
  }

  stopLossValueSuffix(): string {
    return this.form().get('stopLossType')?.value === StopLossType.PERCENTAGE
      ? '%'
      : this.selectedPair()?.quoteAsset?.symbol?.toUpperCase() || '';
  }

  takeProfitValueSuffix(): string {
    const type = this.form().get('takeProfitType')?.value;
    if (type === TakeProfitType.PERCENTAGE) return '%';
    if (type === TakeProfitType.RISK_REWARD) return ':1';
    return this.selectedPair()?.quoteAsset?.symbol?.toUpperCase() || '';
  }

  stopLossHelperText(): string {
    const type = this.form().get('stopLossType')?.value;
    const value = this.form().get('stopLossValue')?.value;
    if (!value) return '';
    if (type === StopLossType.PERCENTAGE) {
      return this.side() === 'BUY'
        ? `Sells if price drops ${value}% below your entry`
        : `Buys back if price rises ${value}% above your entry`;
    }
    return this.side() === 'BUY' ? `Sells if price drops to ${value}` : `Buys back if price rises to ${value}`;
  }

  takeProfitHelperText(): string {
    const type = this.form().get('takeProfitType')?.value;
    const value = this.form().get('takeProfitValue')?.value;
    if (!value) return '';
    if (type === TakeProfitType.PERCENTAGE) {
      return this.side() === 'BUY'
        ? `Sells when price rises ${value}% above your entry`
        : `Buys back when price drops ${value}% below your entry`;
    }
    if (type === TakeProfitType.RISK_REWARD) {
      return `Targets ${value}:1 reward relative to your stop loss distance`;
    }
    return this.side() === 'BUY' ? `Sells when price reaches ${value}` : `Buys back when price drops to ${value}`;
  }

  getTakeProfitTypeOptions() {
    const slEnabled = !!this.form().get('enableStopLoss')?.value;
    return TAKE_PROFIT_TYPE_OPTIONS.map((opt) => ({
      ...opt,
      disabled: opt.value === TakeProfitType.RISK_REWARD && !slEnabled
    }));
  }

  toggleExpanded(): void {
    this.isExpanded.update((v) => !v);
  }

  ngOnInit(): void {
    this.watchToggle('enableStopLoss', [{ name: 'stopLossValue', max: EXIT_CONFIG_LIMITS.STOP_LOSS_MAX }]);
    this.watchToggle('enableTakeProfit', [{ name: 'takeProfitValue', max: EXIT_CONFIG_LIMITS.TAKE_PROFIT_MAX }]);
    this.watchToggle('enableTrailingStop', [
      { name: 'trailingValue', max: EXIT_CONFIG_LIMITS.TRAILING_VALUE_MAX },
      { name: 'trailingActivationValue', max: EXIT_CONFIG_LIMITS.TRAILING_ACTIVATION_MAX }
    ]);
    this.watchTrailingActivation();
    this.watchTakeProfitRiskReward();
  }

  private watchToggle(toggleField: string, valueFields: { name: string; max: number }[]): void {
    this.form()
      .get(toggleField)
      ?.valueChanges.pipe(startWith(this.form().get(toggleField)?.value), takeUntilDestroyed(this.destroyRef))
      .subscribe((enabled: boolean) => {
        valueFields.forEach(({ name, max }) => {
          const control = this.form().get(name);
          if (enabled) {
            control?.setValidators([Validators.required, Validators.min(0.00000001), Validators.max(max)]);
          } else {
            control?.clearValidators();
          }
          control?.updateValueAndValidity();
        });
      });
  }

  private watchTrailingActivation(): void {
    this.form()
      .get('trailingActivation')
      ?.valueChanges.pipe(startWith(this.form().get('trailingActivation')?.value), takeUntilDestroyed(this.destroyRef))
      .subscribe((activation: TrailingActivationType) => {
        const control = this.form().get('trailingActivationValue');
        if (activation !== TrailingActivationType.IMMEDIATE && this.form().get('enableTrailingStop')?.value) {
          control?.setValidators([
            Validators.required,
            Validators.min(0.00000001),
            Validators.max(EXIT_CONFIG_LIMITS.TRAILING_ACTIVATION_MAX)
          ]);
        } else {
          control?.clearValidators();
        }
        control?.updateValueAndValidity();
      });
  }

  private watchTakeProfitRiskReward(): void {
    this.form()
      .get('enableStopLoss')
      ?.valueChanges.pipe(startWith(this.form().get('enableStopLoss')?.value), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        // When SL is disabled and TP type is RISK_REWARD, switch to PERCENTAGE
        const slEnabled = this.form().get('enableStopLoss')?.value;
        const tpType = this.form().get('takeProfitType')?.value;
        if (!slEnabled && tpType === TakeProfitType.RISK_REWARD) {
          this.form().get('takeProfitType')?.setValue(TakeProfitType.PERCENTAGE);
        }
      });
  }

  isRiskRewardDisabled(): boolean {
    return !this.form().get('enableStopLoss')?.value;
  }
}
