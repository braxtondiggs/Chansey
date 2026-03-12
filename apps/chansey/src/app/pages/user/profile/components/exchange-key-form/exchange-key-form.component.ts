import { DatePipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { FloatLabel } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TooltipModule } from 'primeng/tooltip';

import { ExchangeFormState } from '../../profile.types';

@Component({
  selector: 'app-exchange-key-form',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    ButtonModule,
    FloatLabel,
    FluidModule,
    InputTextModule,
    MessageModule,
    TooltipModule
  ],
  templateUrl: './exchange-key-form.component.html'
})
export class ExchangeKeyFormComponent {
  formState = input.required<ExchangeFormState>();
  exchangeName = input.required<string>();
  exchangeId = input.required<string>();
  exchangeSlug = input<string>('');
  exchangeImage = input<string>();
  isActive = input(false);
  connectedAt = input<Date>();

  save = output<void>();
  edit = output<void>();
  cancelEdit = output<void>();
  remove = output<void>();
  showHelp = output<void>();

  showHelpButton = computed(() => this.isBinanceUs() || this.isCoinbase());

  isBinanceUs(): boolean {
    return this.exchangeSlug() === 'binance-us';
  }

  isCoinbase(): boolean {
    return this.exchangeSlug() === 'coinbase';
  }

  onSubmit(): void {
    this.save.emit();
  }
}
