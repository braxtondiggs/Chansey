import { AbstractControl, FormGroup, ValidationErrors } from '@angular/forms';

export function PasswordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password');
  const confirmPassword = control.get('confirmPassword');

  if (password && confirmPassword && password.value !== confirmPassword.value) {
    return { passwordMismatch: true };
  }

  return null;
}

/**
 * Helper function to get password validation error messages
 *
 * @param form The form group containing the password control
 * @param controlName The name of the password control
 * @param formSubmitted Whether the form has been submitted (for required validation)
 * @returns Error message string or empty string if no errors
 */
export function getPasswordError(form: FormGroup, controlName: string, formSubmitted = false): string {
  const control = form.get(controlName);
  if (!control || !control.errors) return '';

  if (control.errors['required'] && formSubmitted) {
    return 'Password is required';
  }

  if (control.errors['passwordStrength']) {
    const errors = control.errors['passwordStrength'];
    if (!errors.hasMinLength) return 'Password must be at least 8 characters';
    if (!errors.hasLowerCase) return 'Password must contain at least one lowercase letter';
    if (!errors.hasUpperCase) return 'Password must contain at least one uppercase letter';
    if (!errors.hasNumeric) return 'Password must contain at least one number';
    if (!errors.hasSpecialChar) return 'Password must contain at least one special character';
  }

  return '';
}
