import { animate, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MenuItem } from 'primeng/api';
import { InputGroupModule } from 'primeng/inputgroup';
import { InputGroupAddonModule } from 'primeng/inputgroupaddon';
import { InputNumberModule } from 'primeng/inputnumber';
import { MenuModule } from 'primeng/menu';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TooltipModule } from 'primeng/tooltip';
import { startWith } from 'rxjs';

import {
  ExitTrailingType,
  StopLossType,
  TakeProfitType,
  TickerPair,
  TrailingActivationType
} from '@chansey/api-interfaces';

import { EXIT_CONFIG_LIMITS } from '../../crypto-trading.constants';

@Component({
  selector: 'app-exit-config',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputGroupModule,
    InputGroupAddonModule,
    InputNumberModule,
    MenuModule,
    ToggleSwitchModule,
    TooltipModule
  ],
  templateUrl: './exit-config.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('slideDown', [
      transition(':enter', [
        style({ height: '0', opacity: 0, overflow: 'hidden' }),
        animate('200ms ease-out', style({ height: '*', opacity: 1 }))
      ]),
      transition(':leave', [
        style({ height: '*', opacity: 1, overflow: 'hidden' }),
        animate('150ms ease-in', style({ height: '0', opacity: 0 }))
      ])
    ])
  ]
})
export class ExitConfigComponent implements OnInit {
  form = input.required<FormGroup>();
  side = input.required<'BUY' | 'SELL'>();
  selectedPair = input.required<TickerPair | null>();

  isExpanded = signal(false);

  readonly limits = EXIT_CONFIG_LIMITS;

  // Stable menu item arrays — built once, mutated in place to avoid reference churn
  readonly stopLossMenuItems: MenuItem[] = [
    {
      label: 'Percentage',
      command: () => this.form().get('stopLossType')?.setValue(StopLossType.PERCENTAGE)
    },
    {
      label: 'Fixed Price',
      command: () => this.form().get('stopLossType')?.setValue(StopLossType.FIXED)
    }
  ];

  readonly takeProfitMenuItems: MenuItem[] = [
    {
      label: 'Percentage',
      command: () => this.form().get('takeProfitType')?.setValue(TakeProfitType.PERCENTAGE)
    },
    {
      label: 'Fixed Price',
      command: () => this.form().get('takeProfitType')?.setValue(TakeProfitType.FIXED)
    },
    {
      label: 'Risk:Reward',
      disabled: true,
      command: () => this.form().get('takeProfitType')?.setValue(TakeProfitType.RISK_REWARD)
    }
  ];

  readonly trailingValueMenuItems: MenuItem[] = [
    {
      label: 'Percentage',
      command: () => this.form().get('trailingType')?.setValue(ExitTrailingType.PERCENTAGE)
    },
    {
      label: 'Amount',
      command: () => this.form().get('trailingType')?.setValue(ExitTrailingType.AMOUNT)
    }
  ];

  readonly trailingActivationMenuItems: MenuItem[] = [
    {
      label: 'Immediately',
      command: () => this.form().get('trailingActivation')?.setValue(TrailingActivationType.IMMEDIATE)
    },
    {
      label: 'At Price',
      command: () => this.form().get('trailingActivation')?.setValue(TrailingActivationType.PRICE)
    },
    {
      label: 'At % Gain',
      command: () => this.form().get('trailingActivation')?.setValue(TrailingActivationType.PERCENTAGE)
    }
  ];

  private readonly destroyRef = inject(DestroyRef);

  activeStrategyCount(): number {
    const f = this.form();
    let count = 0;
    if (f.get('enableStopLoss')?.value) count++;
    if (f.get('enableTakeProfit')?.value) count++;
    if (f.get('enableTrailingStop')?.value) count++;
    return count;
  }

  showOcoToggle(): boolean {
    const f = this.form();
    return !!f.get('enableStopLoss')?.value && !!f.get('enableTakeProfit')?.value;
  }

  isTrailingActivationImmediate(): boolean {
    return this.form().get('trailingActivation')?.value === TrailingActivationType.IMMEDIATE;
  }

  stopLossButtonLabel(): string {
    return this.form().get('stopLossType')?.value === StopLossType.PERCENTAGE ? '%' : this.quoteSymbol() || '$';
  }

  takeProfitButtonLabel(): string {
    const type = this.form().get('takeProfitType')?.value;
    if (type === TakeProfitType.PERCENTAGE) return '%';
    if (type === TakeProfitType.RISK_REWARD) return 'R:R';
    return this.quoteSymbol() || '$';
  }

  trailingValueButtonLabel(): string {
    return this.form().get('trailingType')?.value === ExitTrailingType.PERCENTAGE ? '%' : this.quoteSymbol() || '$';
  }

  trailingActivationButtonLabel(): string {
    return this.form().get('trailingActivation')?.value === TrailingActivationType.PERCENTAGE
      ? '%'
      : this.quoteSymbol() || '$';
  }

  stopLossHelperText(): string {
    const type = this.form().get('stopLossType')?.value;
    const value = this.form().get('stopLossValue')?.value;
    if (!value) return '';
    if (type === StopLossType.PERCENTAGE) {
      return this.side() === 'BUY'
        ? `Automatically sells if price falls ${value}% from your buy price`
        : `Buys back if price rises ${value}% above your entry`;
    }
    const symbol = this.quoteSymbol();
    const suffix = symbol ? ` ${symbol}` : '';
    return this.side() === 'BUY'
      ? `Sells if price drops to ${value}${suffix}`
      : `Buys back if price rises to ${value}${suffix}`;
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
      return `Aims for ${value}x the gain compared to your stop loss risk`;
    }
    const symbol = this.quoteSymbol();
    const suffix = symbol ? ` ${symbol}` : '';
    return this.side() === 'BUY'
      ? `Sells when price reaches ${value}${suffix}`
      : `Buys back when price drops to ${value}${suffix}`;
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

  private quoteSymbol(): string {
    return (this.selectedPair()?.quoteAsset?.symbol?.toUpperCase() || '').slice(0, 6);
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
        const slEnabled = this.form().get('enableStopLoss')?.value;
        // Update Risk:Reward disabled state in the stable menu items array
        const rrItem = this.takeProfitMenuItems.find((i) => i.label === 'Risk:Reward');
        if (rrItem) rrItem.disabled = !slEnabled;
        const tpType = this.form().get('takeProfitType')?.value;
        if (!slEnabled && tpType === TakeProfitType.RISK_REWARD) {
          this.form().get('takeProfitType')?.setValue(TakeProfitType.PERCENTAGE);
        }
      });
  }
}
