import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { MessageService } from 'primeng/api';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DividerModule } from 'primeng/divider';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';

import { AuthService } from '../../../services';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    CardModule,
    DividerModule,
    AvatarModule,
    InputTextModule,
    ToastModule
  ],
  providers: [MessageService],
  template: `
    <div class="card p-4 md:p-6">
      <div class="text-900 mb-4 text-xl font-medium">Profile</div>
      <p class="text-600 mb-5">Manage your personal information and preferences</p>

      <div class="surface-section border-round shadow-2 mb-6 p-4">
        <div class="flex-column align-items-center flex gap-4 md:flex-row">
          <div class="flex-column align-items-center flex">
            <p-avatar [image]="userProfileImage()" size="xlarge" shape="circle" class="mb-2"></p-avatar>
            <span class="text-900 mb-1 font-medium">{{ userName() }}</span>
            <span class="text-600 text-sm">{{ userEmail() }}</span>
          </div>
          <div class="flex-1">
            <div class="card p-fluid">
              <form [formGroup]="profileForm" (ngSubmit)="onSubmit()">
                <div class="formgrid p-fluid grid">
                  <div class="field col-12 md:col-6">
                    <label for="given_name" class="text-900 mb-2 block font-medium">First Name</label>
                    <input id="given_name" type="text" pInputText formControlName="given_name" />
                  </div>
                  <div class="field col-12 md:col-6">
                    <label for="family_name" class="text-900 mb-2 block font-medium">Last Name</label>
                    <input id="family_name" type="text" pInputText formControlName="family_name" />
                  </div>
                  <div class="field col-12">
                    <label for="email" class="text-900 mb-2 block font-medium">Email</label>
                    <input id="email" type="text" pInputText formControlName="email" readonly />
                  </div>
                  <div class="col-12">
                    <button
                      pButton
                      type="submit"
                      label="Save Changes"
                      [disabled]="!profileForm.valid || !profileForm.dirty"
                      class="mt-3 w-auto"
                    ></button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
    <p-toast></p-toast>
  `
})
export class ProfileComponent {
  private userSignal: any;

  profileForm: FormGroup;
  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private messageService: MessageService
  ) {
    this.userSignal = toSignal(this.authService.user$, { initialValue: null });

    this.profileForm = this.fb.group({
      given_name: ['', Validators.required],
      family_name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]]
    });

    this.initFormData();
  }

  userProfileImage = () => {
    const user = this.userSignal();
    return user?.['picture'] || `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${user?.['given_name']}`;
  };

  userName = () => {
    const user = this.userSignal();
    if (!user) return '';
    return `${user['given_name'] || ''} ${user['family_name'] || ''}`.trim();
  };

  userEmail = () => {
    const user = this.userSignal();
    return user?.['email'] || '';
  };

  private initFormData(): void {
    const user = this.userSignal();
    if (user) {
      this.profileForm.patchValue({
        given_name: user['given_name'] || '',
        family_name: user['family_name'] || '',
        email: user['email'] || ''
      });
    }
  }

  onSubmit(): void {
    if (this.profileForm.valid) {
      // In a real application, you would implement the API call to update the profile
      console.log('Profile update:', this.profileForm.value);
      this.messageService.add({
        severity: 'success',
        summary: 'Profile Updated',
        detail: 'Your profile information has been updated successfully'
      });
      this.profileForm.markAsPristine();
    }
  }
}
