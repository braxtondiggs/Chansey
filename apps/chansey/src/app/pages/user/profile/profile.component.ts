import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { ConfirmationService, MessageService } from 'primeng/api';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { FileUploadModule } from 'primeng/fileupload';
import { FloatLabel } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';

import { AuthService } from '@chansey-web/app/services';
import { PasswordStrengthValidator, PasswordMatchValidator, getPasswordError } from '@chansey-web/app/validators';

import { ProfileService, Risk } from './profile.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    AvatarModule,
    ButtonModule,
    CardModule,
    CommonModule,
    ConfirmDialogModule,
    FileUploadModule,
    FloatLabel,
    FluidModule,
    InputTextModule,
    MessageModule,
    PasswordModule,
    ReactiveFormsModule,
    SelectModule,
    ToastModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './profile.component.html'
})
export class ProfileComponent {
  private userSignal: any;
  messages = signal<any[]>([]);
  profileForm: FormGroup;
  passwordForm: FormGroup;
  uploadedFile: any = null;
  formSubmitted = false;
  passwordFormSubmitted = false;
  profileLoading = false;
  passwordLoading = false;
  risks = signal<Risk[]>([]);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private profileService: ProfileService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService
  ) {
    this.userSignal = toSignal(this.authService.user$, { initialValue: null });
    this.passwordForm = this.fb.group(
      {
        currentPassword: ['', Validators.required],
        newPassword: ['', [Validators.required, PasswordStrengthValidator()]],
        confirmPassword: ['', [Validators.required]]
      },
      { validators: PasswordMatchValidator }
    );

    this.profileForm = this.fb.group({
      given_name: ['', Validators.required],
      family_name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      risk: ['', Validators.required]
    });

    this.initFormData();
    this.loadRisks();
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
        email: user['email'] || '',
        risk: user.risk.id || ''
      });
    }
  }

  private loadRisks(): void {
    this.profileService.getRisks().subscribe({
      next: (risks) => {
        this.risks.set(risks);
      },
      error: (error) => {
        console.error('Error loading risks:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Failed to Load Risks',
          detail: 'Could not load risk profiles. Please try again later.'
        });
      }
    });
  }

  getPasswordError(controlName: string): string {
    return getPasswordError(this.passwordForm, controlName, this.passwordFormSubmitted);
  }

  onSubmit(): void {
    this.formSubmitted = true;
    if (this.profileForm.valid) {
      // Prepare JSON data for API submission
      const profileData = this.profileForm.getRawValue();
      const initialUser = this.userSignal();
      const updatedFields: any = {};
      const isEmailChanged = profileData.email !== initialUser['email'];

      Object.keys(profileData).forEach((key) => {
        if (profileData[key] !== null && profileData[key] !== undefined && profileData[key] !== initialUser[key]) {
          updatedFields[key] = profileData[key];
        }
      });

      if (Object.keys(updatedFields).length === 0 && !this.uploadedFile) return;

      if (isEmailChanged) {
        this.confirmationService.confirm({
          message: 'Changing your email will log you out and require email verification. Do you want to continue?',
          header: 'Email Change Confirmation',
          icon: 'pi pi-exclamation-triangle',
          accept: () => {
            this.processProfileUpdate(updatedFields, isEmailChanged);
          }
        });
      } else {
        this.processProfileUpdate(updatedFields, isEmailChanged);
      }
    }
  }

  onChangePassword(): void {
    this.passwordFormSubmitted = true;
    if (this.passwordForm.valid) {
      this.passwordLoading = true;
      const passwordData = {
        old_password: this.passwordForm.get('currentPassword')?.value,
        new_password: this.passwordForm.get('newPassword')?.value,
        confirm_new_password: this.passwordForm.get('confirmPassword')?.value
      };

      this.profileService.changePassword(passwordData).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Password Changed',
            detail: 'Your password has been updated successfully'
          });
          this.passwordForm.reset();
          this.passwordFormSubmitted = false;
          this.passwordLoading = false;
        },
        error: (error) => {
          let errorMessage = 'Failed to update password. Please try again.';

          if (error.status === 400) {
            errorMessage = 'Invalid password. Please check your inputs and try again.';
          }

          this.messageService.add({
            severity: 'error',
            summary: 'Password Change Failed',
            detail: errorMessage
          });
          this.passwordLoading = false;
        }
      });
    }
  }

  private processProfileUpdate(updatedFields: any, isEmailChanged: boolean): void {
    this.profileLoading = true;

    if (this.uploadedFile) {
      updatedFields.profileImage = this.uploadedFile.base64;
    }

    this.profileService.updateProfile(updatedFields).subscribe({
      next: (response) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Profile Updated',
          detail: 'Your profile information has been updated successfully'
        });

        this.profileForm.markAsPristine();
        this.uploadedFile = null;
        this.profileLoading = false;

        if (isEmailChanged) {
          this.messages.set([
            {
              severity: 'info',
              content: 'You will be logged out shortly. Please check your new email for verification instructions.',
              icon: 'pi-info-circle'
            }
          ]);

          setTimeout(() => {
            this.authService.logout();
          }, 5000);
        }
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Update Failed',
          detail: error.error.message || 'Failed to update profile. Please try again.'
        });
        this.profileLoading = false;
      }
    });
  }

  onUpload(event: any): void {
    if (event.files && event.files.length > 0) {
      const file = event.files[0];

      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        this.uploadedFile = {
          name: file.name,
          type: file.type,
          size: file.size,
          base64: reader.result as string
        };

        this.messageService.add({
          severity: 'info',
          summary: 'File Uploaded',
          detail: 'Profile picture update will be applied when you save your profile'
        });
      };
    }
  }
}
