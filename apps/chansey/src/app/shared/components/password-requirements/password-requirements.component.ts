import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-password-requirements',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="my-0 ml-2 pl-2 leading-normal" aria-label="Password requirements">
      <li>At least one lowercase</li>
      <li>At least one uppercase</li>
      <li>At least one numeric</li>
      <li>At least one special character</li>
      <li>Minimum 8 characters</li>
    </ul>
  `
})
export class PasswordRequirementsComponent {}
