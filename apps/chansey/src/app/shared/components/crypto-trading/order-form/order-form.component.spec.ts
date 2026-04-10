import { type ComponentRef } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { FormBuilder, type FormGroup, Validators } from '@angular/forms';
import { By } from '@angular/platform-browser';

import { OrderType } from '@chansey/api-interfaces';

import { OrderFormComponent } from './order-form.component';

describe('OrderFormComponent', () => {
  let component: OrderFormComponent;
  let componentRef: ComponentRef<OrderFormComponent>;
  let fixture: ComponentFixture<OrderFormComponent>;
  let fb: FormBuilder;
  let testForm: FormGroup;

  beforeEach(async () => {
    fb = new FormBuilder();
    testForm = fb.group({
      type: [OrderType.MARKET],
      quantity: [null, [Validators.required, Validators.min(0.001)]],
      price: [null, [Validators.required, Validators.min(0.01)]]
    });

    await TestBed.configureTestingModule({
      imports: [OrderFormComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(OrderFormComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;

    componentRef.setInput('side', 'BUY');
    componentRef.setInput('form', testForm);
    componentRef.setInput('selectedPair', null);
    componentRef.setInput('orderTypeOptions', []);
    componentRef.setInput('quickAmountOptions', []);
    componentRef.setInput('trailingTypeOptions', []);
    componentRef.setInput('orderPreview', null);
    componentRef.setInput('selectedPercentage', null);
    componentRef.setInput('isSubmitting', false);
    componentRef.setInput('hasSufficientBalance', true);
    componentRef.setInput('fallbackTotal', 0);
    componentRef.setInput('fallbackNet', 0);

    fixture.detectChanges();
  });

  describe('shouldShowPriceField', () => {
    it.each([
      { type: OrderType.LIMIT, expected: true },
      { type: OrderType.STOP_LIMIT, expected: true },
      { type: OrderType.MARKET, expected: false }
    ])('should return $expected for $type', ({ type, expected }) => {
      testForm.get('type')?.setValue(type);
      expect(component.shouldShowPriceField()).toBe(expected);
    });
  });

  describe('shouldShowStopPriceField', () => {
    it.each([
      { type: OrderType.STOP_LOSS, expected: true },
      { type: OrderType.STOP_LIMIT, expected: true },
      { type: OrderType.MARKET, expected: false }
    ])('should return $expected for $type', ({ type, expected }) => {
      testForm.get('type')?.setValue(type);
      expect(component.shouldShowStopPriceField()).toBe(expected);
    });
  });

  describe('shouldShowTrailingFields', () => {
    it.each([
      { type: OrderType.TRAILING_STOP, expected: true },
      { type: OrderType.MARKET, expected: false }
    ])('should return $expected for $type', ({ type, expected }) => {
      testForm.get('type')?.setValue(type);
      expect(component.shouldShowTrailingFields()).toBe(expected);
    });
  });

  describe('shouldShowTakeProfitField', () => {
    it.each([
      { type: OrderType.TAKE_PROFIT, expected: true },
      { type: OrderType.OCO, expected: true },
      { type: OrderType.MARKET, expected: false }
    ])('should return $expected for $type', ({ type, expected }) => {
      testForm.get('type')?.setValue(type);
      expect(component.shouldShowTakeProfitField()).toBe(expected);
    });
  });

  describe('shouldShowStopLossField', () => {
    it.each([
      { type: OrderType.OCO, expected: true },
      { type: OrderType.MARKET, expected: false },
      { type: OrderType.STOP_LOSS, expected: false }
    ])('should return $expected for $type', ({ type, expected }) => {
      testForm.get('type')?.setValue(type);
      expect(component.shouldShowStopLossField()).toBe(expected);
    });
  });

  describe('isFieldInvalid', () => {
    it('should return false when field is valid and touched', () => {
      testForm.get('quantity')?.setValue(1);
      testForm.get('quantity')?.markAsTouched();
      expect(component.isFieldInvalid('quantity')).toBe(false);
    });

    it('should return true when field is invalid and touched', () => {
      testForm.get('quantity')?.setValue(null);
      testForm.get('quantity')?.markAsTouched();
      expect(component.isFieldInvalid('quantity')).toBe(true);
    });

    it('should return true when field is invalid and dirty', () => {
      testForm.get('quantity')?.setValue(null);
      testForm.get('quantity')?.markAsDirty();
      expect(component.isFieldInvalid('quantity')).toBe(true);
    });

    it('should return false when field is invalid but pristine and untouched', () => {
      testForm.get('quantity')?.setValue(null);
      expect(component.isFieldInvalid('quantity')).toBe(false);
    });

    it('should return false for a nonexistent field', () => {
      expect(component.isFieldInvalid('nonexistent')).toBe(false);
    });
  });

  describe('getFieldError', () => {
    it('should return empty string when field has no errors', () => {
      testForm.get('quantity')?.setValue(1);
      expect(component.getFieldError('quantity')).toBe('');
    });

    it('should return "This field is required" for required error', () => {
      testForm.get('quantity')?.setValue(null);
      testForm.get('quantity')?.markAsTouched();
      expect(component.getFieldError('quantity')).toBe('This field is required');
    });

    it('should return minimum value message for min error', () => {
      testForm.get('quantity')?.setValue(0.0001);
      testForm.get('quantity')?.markAsTouched();
      expect(component.getFieldError('quantity')).toBe('Minimum value is 0.001');
    });

    it('should not use fixed decimal for min value at boundary (0.0001)', () => {
      const boundaryForm = fb.group({
        type: [OrderType.MARKET],
        quantity: [null as number | null, [Validators.required, Validators.min(0.0001)]],
        price: [null as number | null]
      });
      boundaryForm.get('quantity')?.setValue(0.00001);
      componentRef.setInput('form', boundaryForm);
      fixture.detectChanges();
      expect(component.getFieldError('quantity')).toBe('Minimum value is 0.0001');
    });

    it('should format very small min values with 8 decimal places', () => {
      const smallMinForm = fb.group({
        type: [OrderType.MARKET],
        quantity: [null as number | null, [Validators.required, Validators.min(0.00001)]],
        price: [null as number | null]
      });
      smallMinForm.get('quantity')?.setValue(0.000001);
      componentRef.setInput('form', smallMinForm);
      fixture.detectChanges();
      expect(component.getFieldError('quantity')).toBe('Minimum value is 0.00001000');
    });

    it('should return "Invalid value" for unknown error types', () => {
      testForm.get('quantity')?.setErrors({ custom: true });
      expect(component.getFieldError('quantity')).toBe('Invalid value');
    });

    it('should return empty string for a nonexistent field', () => {
      expect(component.getFieldError('nonexistent')).toBe('');
    });

    it('should prioritize required error over min error', () => {
      testForm.get('quantity')?.setErrors({ required: true, min: { min: 0.001 } });
      expect(component.getFieldError('quantity')).toBe('This field is required');
    });
  });

  describe('buttonLabel', () => {
    it('should include base asset symbol when pair is selected (BUY)', () => {
      componentRef.setInput('selectedPair', { id: '1', symbol: 'BTC/USD', baseAsset: { symbol: 'BTC' } });
      fixture.detectChanges();
      expect(component.buttonLabel()).toBe('Buy BTC');
    });

    it('should include base asset symbol when pair is selected (SELL)', () => {
      componentRef.setInput('side', 'SELL');
      componentRef.setInput('selectedPair', { id: '1', symbol: 'BTC/USD', baseAsset: { symbol: 'BTC' } });
      fixture.detectChanges();
      expect(component.buttonLabel()).toBe('Sell BTC');
    });

    it('should return just side label when no pair is selected', () => {
      componentRef.setInput('selectedPair', null);
      fixture.detectChanges();
      expect(component.buttonLabel()).toBe('Buy');
    });
  });

  describe('outputs', () => {
    it('should emit submitOrder on form submit', () => {
      const emitSpy = jest.spyOn(component.submitOrder, 'emit');

      testForm.get('quantity')?.setValue(1);
      testForm.get('price')?.setValue(100);
      fixture.detectChanges();

      component.onSubmit();

      expect(emitSpy).toHaveBeenCalledTimes(1);
    });

    it('should emit percentageChange with value', () => {
      const emitSpy = jest.spyOn(component.percentageChange, 'emit');

      component.onPercentageChange(25);

      expect(emitSpy).toHaveBeenCalledWith(25);
    });

    it('should emit percentageChange with null', () => {
      const emitSpy = jest.spyOn(component.percentageChange, 'emit');

      component.onPercentageChange(null);

      expect(emitSpy).toHaveBeenCalledWith(null);
    });
  });

  describe('submit button DOM disabled state', () => {
    it('should render submit button as disabled when form is invalid and no pair', () => {
      testForm.get('quantity')?.setValue(null);
      componentRef.setInput('selectedPair', null);
      fixture.detectChanges();

      const button = fixture.debugElement.query(By.css('button[type="submit"]'));
      expect(button).toBeTruthy();
      expect(button.nativeElement.disabled).toBe(true);
    });

    it('should render submit button as enabled when form is valid and pair is selected', () => {
      testForm.get('quantity')?.setValue(1);
      testForm.get('price')?.setValue(100);
      componentRef.setInput('selectedPair', { id: '1', symbol: 'BTC/USD', baseAsset: { symbol: 'BTC' } });
      componentRef.setInput('hasSufficientBalance', true);
      fixture.detectChanges();

      const button = fixture.debugElement.query(By.css('button[type="submit"]'));
      expect(button).toBeTruthy();
      expect(button.nativeElement.disabled).toBe(false);
    });
  });
});
