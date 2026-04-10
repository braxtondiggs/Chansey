import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type AbstractControl, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import {
  ExitTrailingType,
  StopLossType,
  TakeProfitType,
  type TickerPair,
  TrailingActivationType
} from '@chansey/api-interfaces';

import { ExitConfigComponent } from './exit-config.component';

describe('ExitConfigComponent', () => {
  let component: ExitConfigComponent;
  let fixture: ComponentFixture<ExitConfigComponent>;
  let form: FormGroup;

  const mockPair: TickerPair = {
    quoteAsset: { symbol: 'usdt' }
  } as TickerPair;

  function buildForm(overrides: Record<string, unknown> = {}): FormGroup {
    return new FormGroup({
      enableStopLoss: new FormControl(false),
      stopLossType: new FormControl(StopLossType.PERCENTAGE),
      stopLossValue: new FormControl(2.0),
      enableTakeProfit: new FormControl(false),
      takeProfitType: new FormControl(TakeProfitType.PERCENTAGE),
      takeProfitValue: new FormControl(5.0),
      enableTrailingStop: new FormControl(false),
      trailingType: new FormControl(ExitTrailingType.PERCENTAGE),
      trailingValue: new FormControl(1.0),
      trailingActivation: new FormControl(TrailingActivationType.IMMEDIATE),
      trailingActivationValue: new FormControl(null),
      useOco: new FormControl(true),
      ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, new FormControl(v)]))
    });
  }

  beforeEach(async () => {
    form = buildForm();

    await TestBed.configureTestingModule({
      imports: [ExitConfigComponent, ReactiveFormsModule, NoopAnimationsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(ExitConfigComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('side', 'BUY');
    fixture.componentRef.setInput('selectedPair', null);
    fixture.detectChanges();
  });

  describe('expand / collapse', () => {
    it('should start collapsed and toggle on each call', () => {
      expect(component.isExpanded()).toBe(false);
      expect(fixture.nativeElement.querySelector('#exitConfigPanel')).toBeNull();

      component.toggleExpanded();
      fixture.detectChanges();
      expect(component.isExpanded()).toBe(true);
      expect(fixture.nativeElement.querySelector('#exitConfigPanel')).toBeTruthy();

      component.toggleExpanded();
      fixture.detectChanges();
      expect(component.isExpanded()).toBe(false);
    });
  });

  describe('showOcoToggle', () => {
    it('should return true only when both SL and TP are enabled', () => {
      expect(component.showOcoToggle()).toBe(false);

      form.get('enableStopLoss')?.setValue(true);
      expect(component.showOcoToggle()).toBe(false);

      form.get('enableTakeProfit')?.setValue(true);
      expect(component.showOcoToggle()).toBe(true);

      form.get('enableStopLoss')?.setValue(false);
      expect(component.showOcoToggle()).toBe(false);
    });
  });

  describe('stopLossButtonLabel', () => {
    it('should return % for PERCENTAGE type', () => {
      form.get('stopLossType')?.setValue(StopLossType.PERCENTAGE);
      expect(component.stopLossButtonLabel()).toBe('%');
    });

    it('should return quote symbol for FIXED type with selected pair', () => {
      fixture.componentRef.setInput('selectedPair', mockPair);
      form.get('stopLossType')?.setValue(StopLossType.FIXED);
      expect(component.stopLossButtonLabel()).toBe('USDT');
    });

    it('should return $ for FIXED type without selected pair', () => {
      form.get('stopLossType')?.setValue(StopLossType.FIXED);
      expect(component.stopLossButtonLabel()).toBe('$');
    });
  });

  describe('isTrailingActivationImmediate', () => {
    it('should return true for IMMEDIATE, false for other types', () => {
      expect(component.isTrailingActivationImmediate()).toBe(true);

      form.get('trailingActivation')?.setValue(TrailingActivationType.PRICE);
      expect(component.isTrailingActivationImmediate()).toBe(false);

      form.get('trailingActivation')?.setValue(TrailingActivationType.PERCENTAGE);
      expect(component.isTrailingActivationImmediate()).toBe(false);
    });
  });

  describe('watchToggle validators', () => {
    it('should add required+min validators when SL is enabled and clear when disabled', () => {
      const slValue = form.get('stopLossValue') as AbstractControl;

      form.get('enableStopLoss')?.setValue(true);
      slValue.setValue(null);
      expect(slValue.valid).toBe(false);

      slValue.setValue(0);
      expect(slValue.valid).toBe(false);

      slValue.setValue(0.00000001);
      expect(slValue.valid).toBe(true);

      form.get('enableStopLoss')?.setValue(false);
      slValue.setValue(null);
      expect(slValue.valid).toBe(true);
    });

    it('should add required+min validators when TP is enabled and clear when disabled', () => {
      const tpValue = form.get('takeProfitValue') as AbstractControl;

      form.get('enableTakeProfit')?.setValue(true);
      tpValue.setValue(null);
      expect(tpValue.valid).toBe(false);

      form.get('enableTakeProfit')?.setValue(false);
      tpValue.setValue(null);
      expect(tpValue.valid).toBe(true);
    });

    it('should add required+min validators when trailing stop is enabled and clear when disabled', () => {
      const trailingValue = form.get('trailingValue') as AbstractControl;

      form.get('enableTrailingStop')?.setValue(true);
      trailingValue.setValue(null);
      expect(trailingValue.valid).toBe(false);

      form.get('enableTrailingStop')?.setValue(false);
      trailingValue.setValue(null);
      expect(trailingValue.valid).toBe(true);
    });
  });

  describe('max bound validators', () => {
    it('should invalidate stopLossValue exceeding max when SL is enabled', () => {
      const slValue = form.get('stopLossValue') as AbstractControl;
      form.get('enableStopLoss')?.setValue(true);
      slValue.setValue(10_000_001);
      expect(slValue.valid).toBe(false);

      slValue.setValue(10_000_000);
      expect(slValue.valid).toBe(true);
    });

    it('should invalidate takeProfitValue exceeding max when TP is enabled', () => {
      const tpValue = form.get('takeProfitValue') as AbstractControl;
      form.get('enableTakeProfit')?.setValue(true);
      tpValue.setValue(100_000_001);
      expect(tpValue.valid).toBe(false);

      tpValue.setValue(100_000_000);
      expect(tpValue.valid).toBe(true);
    });

    it('should invalidate trailingValue exceeding max when trailing stop is enabled', () => {
      const trailingValue = form.get('trailingValue') as AbstractControl;
      form.get('enableTrailingStop')?.setValue(true);
      trailingValue.setValue(10_000_001);
      expect(trailingValue.valid).toBe(false);

      trailingValue.setValue(10_000_000);
      expect(trailingValue.valid).toBe(true);
    });

    it('should invalidate trailingActivationValue exceeding max', () => {
      const activationValue = form.get('trailingActivationValue') as AbstractControl;
      form.get('enableTrailingStop')?.setValue(true);
      form.get('trailingActivation')?.setValue(TrailingActivationType.PRICE);
      activationValue.setValue(100_000_001);
      expect(activationValue.valid).toBe(false);

      activationValue.setValue(100_000_000);
      expect(activationValue.valid).toBe(true);
    });
  });

  describe('watchTrailingActivation', () => {
    it('should require trailingActivationValue when non-IMMEDIATE and trailing is enabled', () => {
      const activationValue = form.get('trailingActivationValue') as AbstractControl;

      form.get('enableTrailingStop')?.setValue(true);
      form.get('trailingActivation')?.setValue(TrailingActivationType.PRICE);
      activationValue.setValue(null);
      expect(activationValue.valid).toBe(false);

      activationValue.setValue(100);
      expect(activationValue.valid).toBe(true);
    });

    it('should clear trailingActivationValue validators when activation is IMMEDIATE', () => {
      const activationValue = form.get('trailingActivationValue') as AbstractControl;

      form.get('enableTrailingStop')?.setValue(true);
      form.get('trailingActivation')?.setValue(TrailingActivationType.PRICE);
      form.get('trailingActivation')?.setValue(TrailingActivationType.IMMEDIATE);
      activationValue.setValue(null);
      expect(activationValue.valid).toBe(true);
    });

    it('should clear trailingActivationValue validators when trailing stop is disabled', () => {
      const activationValue = form.get('trailingActivationValue') as AbstractControl;

      form.get('enableTrailingStop')?.setValue(false);
      form.get('trailingActivation')?.setValue(TrailingActivationType.PERCENTAGE);
      activationValue.setValue(null);
      expect(activationValue.valid).toBe(true);
    });
  });

  describe('watchTakeProfitRiskReward', () => {
    it('should switch TP type from RISK_REWARD to PERCENTAGE when SL is disabled', () => {
      form.get('enableStopLoss')?.setValue(true);
      form.get('enableTakeProfit')?.setValue(true);
      form.get('takeProfitType')?.setValue(TakeProfitType.RISK_REWARD);

      form.get('enableStopLoss')?.setValue(false);
      expect(form.get('takeProfitType')?.value).toBe(TakeProfitType.PERCENTAGE);
    });

    it('should not change TP type when SL is disabled and TP type is not RISK_REWARD', () => {
      form.get('enableStopLoss')?.setValue(true);
      form.get('enableTakeProfit')?.setValue(true);
      form.get('takeProfitType')?.setValue(TakeProfitType.FIXED);

      form.get('enableStopLoss')?.setValue(false);
      expect(form.get('takeProfitType')?.value).toBe(TakeProfitType.FIXED);
    });
  });

  describe('takeProfitMenuItems', () => {
    it('should have Risk:Reward disabled when SL is off', () => {
      form.get('enableStopLoss')?.setValue(false);
      const rr = component.takeProfitMenuItems.find((i) => i.label === 'Risk:Reward');
      expect(rr?.disabled).toBe(true);
    });

    it('should have Risk:Reward enabled when SL is on', () => {
      form.get('enableStopLoss')?.setValue(true);
      const rr = component.takeProfitMenuItems.find((i) => i.label === 'Risk:Reward');
      expect(rr?.disabled).toBe(false);
    });
  });

  describe('takeProfitButtonLabel', () => {
    it('should return % for PERCENTAGE type', () => {
      form.get('takeProfitType')?.setValue(TakeProfitType.PERCENTAGE);
      expect(component.takeProfitButtonLabel()).toBe('%');
    });

    it('should return R:R for RISK_REWARD type', () => {
      form.get('takeProfitType')?.setValue(TakeProfitType.RISK_REWARD);
      expect(component.takeProfitButtonLabel()).toBe('R:R');
    });

    it('should return quote symbol for FIXED type with selected pair', () => {
      fixture.componentRef.setInput('selectedPair', mockPair);
      form.get('takeProfitType')?.setValue(TakeProfitType.FIXED);
      expect(component.takeProfitButtonLabel()).toBe('USDT');
    });

    it('should return $ for FIXED type without selected pair', () => {
      form.get('takeProfitType')?.setValue(TakeProfitType.FIXED);
      expect(component.takeProfitButtonLabel()).toBe('$');
    });
  });

  describe('trailingValueButtonLabel', () => {
    it('should return % for PERCENTAGE type', () => {
      form.get('trailingType')?.setValue(ExitTrailingType.PERCENTAGE);
      expect(component.trailingValueButtonLabel()).toBe('%');
    });

    it('should return quote symbol for AMOUNT type with selected pair', () => {
      fixture.componentRef.setInput('selectedPair', mockPair);
      form.get('trailingType')?.setValue(ExitTrailingType.AMOUNT);
      expect(component.trailingValueButtonLabel()).toBe('USDT');
    });

    it('should return $ for AMOUNT type without selected pair', () => {
      form.get('trailingType')?.setValue(ExitTrailingType.AMOUNT);
      expect(component.trailingValueButtonLabel()).toBe('$');
    });
  });

  describe('stopLossHelperText', () => {
    it('should return empty string when value is falsy', () => {
      form.get('enableStopLoss')?.setValue(true);
      form.get('stopLossValue')?.setValue(null);
      expect(component.stopLossHelperText()).toBe('');
    });

    it.each([
      { side: 'BUY' as const, expected: 'Automatically sells if price falls 2% from your buy price' },
      { side: 'SELL' as const, expected: 'Buys back if price rises 2% above your entry' }
    ])('should return percentage text for $side side', ({ side, expected }) => {
      fixture.componentRef.setInput('side', side);
      form.get('stopLossType')?.setValue(StopLossType.PERCENTAGE);
      form.get('stopLossValue')?.setValue(2);
      expect(component.stopLossHelperText()).toBe(expected);
    });

    it.each([
      { side: 'BUY' as const, expected: 'Sells if price drops to 100' },
      { side: 'SELL' as const, expected: 'Buys back if price rises to 100' }
    ])('should return fixed text for $side side', ({ side, expected }) => {
      fixture.componentRef.setInput('side', side);
      form.get('stopLossType')?.setValue(StopLossType.FIXED);
      form.get('stopLossValue')?.setValue(100);
      expect(component.stopLossHelperText()).toBe(expected);
    });
  });

  describe('takeProfitHelperText', () => {
    it('should return empty string when value is falsy', () => {
      form.get('enableTakeProfit')?.setValue(true);
      form.get('takeProfitValue')?.setValue(null);
      expect(component.takeProfitHelperText()).toBe('');
    });

    it.each([
      { side: 'BUY' as const, expected: 'Sells when price rises 5% above your entry' },
      { side: 'SELL' as const, expected: 'Buys back when price drops 5% below your entry' }
    ])('should return percentage text for $side side', ({ side, expected }) => {
      fixture.componentRef.setInput('side', side);
      form.get('takeProfitType')?.setValue(TakeProfitType.PERCENTAGE);
      form.get('takeProfitValue')?.setValue(5);
      expect(component.takeProfitHelperText()).toBe(expected);
    });

    it('should return risk reward text', () => {
      form.get('takeProfitType')?.setValue(TakeProfitType.RISK_REWARD);
      form.get('takeProfitValue')?.setValue(3);
      expect(component.takeProfitHelperText()).toBe('Aims for 3x the gain compared to your stop loss risk');
    });

    it.each([
      { side: 'BUY' as const, expected: 'Sells when price reaches 500' },
      { side: 'SELL' as const, expected: 'Buys back when price drops to 500' }
    ])('should return fixed text for $side side', ({ side, expected }) => {
      fixture.componentRef.setInput('side', side);
      form.get('takeProfitType')?.setValue(TakeProfitType.FIXED);
      form.get('takeProfitValue')?.setValue(500);
      expect(component.takeProfitHelperText()).toBe(expected);
    });
  });
});
