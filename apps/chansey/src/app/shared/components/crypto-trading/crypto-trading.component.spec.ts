import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

import { CryptoTradingComponent } from './crypto-trading.component';

xdescribe('CryptoTradingComponent', () => {
  let component: CryptoTradingComponent;
  let fixture: ComponentFixture<CryptoTradingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CryptoTradingComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(CryptoTradingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

xdescribe('CryptoTradingComponent - Validation Helpers', () => {
  let component: CryptoTradingComponent;
  let fb: FormBuilder;
  let testForm: FormGroup;

  beforeEach(() => {
    fb = new FormBuilder();
    // Create a minimal component instance for testing helper methods
    component = new CryptoTradingComponent();

    // Create a test form with validation
    testForm = fb.group({
      quantity: [null, [Validators.required, Validators.min(0.001)]],
      price: [null, [Validators.required, Validators.min(0.001)]]
    });
  });

  describe('isFieldInvalid', () => {
    it('should return false when field is valid', () => {
      testForm.get('quantity')?.setValue(1);
      testForm.get('quantity')?.markAsTouched();

      expect(component.isFieldInvalid(testForm, 'quantity')).toBe(false);
    });

    it('should return true when field is invalid and touched', () => {
      testForm.get('quantity')?.setValue(null);
      testForm.get('quantity')?.markAsTouched();

      expect(component.isFieldInvalid(testForm, 'quantity')).toBe(true);
    });

    it('should return true when field is invalid and dirty', () => {
      testForm.get('quantity')?.setValue(null);
      testForm.get('quantity')?.markAsDirty();

      expect(component.isFieldInvalid(testForm, 'quantity')).toBe(true);
    });

    it('should return false when field is invalid but pristine and untouched', () => {
      testForm.get('quantity')?.setValue(null);

      expect(component.isFieldInvalid(testForm, 'quantity')).toBe(false);
    });

    it('should return false when field does not exist', () => {
      expect(component.isFieldInvalid(testForm, 'nonexistent')).toBe(false);
    });

    it('should return true when field is below minimum and touched', () => {
      testForm.get('quantity')?.setValue(0.0001);
      testForm.get('quantity')?.markAsTouched();

      expect(component.isFieldInvalid(testForm, 'quantity')).toBe(true);
    });
  });

  describe('getFieldError', () => {
    it('should return empty string when field has no errors', () => {
      testForm.get('quantity')?.setValue(1);

      expect(component.getFieldError(testForm, 'quantity')).toBe('');
    });

    it('should return "This field is required" when field has required error', () => {
      testForm.get('quantity')?.setValue(null);
      testForm.get('quantity')?.markAsTouched();

      expect(component.getFieldError(testForm, 'quantity')).toBe('This field is required');
    });

    it('should return minimum value message when field has min error', () => {
      testForm.get('quantity')?.setValue(0.0001);
      testForm.get('quantity')?.markAsTouched();

      const errorMessage = component.getFieldError(testForm, 'quantity');
      expect(errorMessage).toBe('Minimum value is 0.001');
    });

    it('should return empty string when field does not exist', () => {
      expect(component.getFieldError(testForm, 'nonexistent')).toBe('');
    });

    it('should return "Invalid value" for unknown error types', () => {
      testForm.get('quantity')?.setErrors({ custom: true });

      expect(component.getFieldError(testForm, 'quantity')).toBe('Invalid value');
    });

    it('should prioritize required error over min error', () => {
      testForm.get('quantity')?.setValue(null);
      testForm.get('quantity')?.markAsTouched();
      testForm.get('quantity')?.setErrors({ required: true, min: { min: 0.001 } });

      expect(component.getFieldError(testForm, 'quantity')).toBe('This field is required');
    });
  });
});
