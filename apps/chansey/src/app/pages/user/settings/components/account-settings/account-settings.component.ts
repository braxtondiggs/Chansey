import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ConfirmationService, MessageService } from 'primeng/api';
import { timer } from 'rxjs';

import { IUserProfileUpdate } from '@chansey/api-interfaces';

import { AuthMessage } from '../../../../../shared/components/auth-messages/auth-message.interface';
import { AuthService } from '../../../../../shared/services/auth.service';
import { SettingsService } from '../../settings.service';
import { ProfileInfoComponent } from '../profile-info/profile-info.component';

@Component({
  selector: 'app-account-settings',
  imports: [ProfileInfoComponent],
  templateUrl: './account-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AccountSettingsComponent {
  private authService = inject(AuthService);
  private settingsService = inject(SettingsService);
  private confirmationService = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private destroyRef = inject(DestroyRef);
  private logoutMutation = this.authService.useLogoutMutation();

  readonly profileInfo = viewChild.required<ProfileInfoComponent>('profileInfo');

  private readonly userQuery = this.authService.useUser();
  readonly updateProfileMutation = this.settingsService.useUpdateProfileMutation();
  readonly uploadProfileImageMutation = this.settingsService.useUploadProfileImageMutation();

  user = computed(() => this.userQuery.data());
  isLoading = computed(() => this.userQuery.isLoading());

  messages = signal<AuthMessage[]>([]);

  onSubmitProfile(updatedFields: Partial<IUserProfileUpdate>): void {
    const isEmailChanged = this.profileInfo()?.isEmailChanged() ?? false;

    if (isEmailChanged) {
      this.confirmationService.confirm({
        message: 'Changing your email will log you out and require email verification. Do you want to continue?',
        header: 'Email Change Confirmation',
        icon: 'pi pi-exclamation-triangle',
        accept: () => this.processProfileUpdate(updatedFields, true)
      });
    } else {
      this.processProfileUpdate(updatedFields, false);
    }
  }

  private processProfileUpdate(updatedFields: Partial<IUserProfileUpdate>, isEmailChanged: boolean): void {
    this.updateProfileMutation.mutate(updatedFields, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Profile Updated',
          detail: 'Your profile information has been updated successfully'
        });
        this.profileInfo()?.markAsPristine();

        if (isEmailChanged) {
          this.messages.set([
            {
              severity: 'info',
              content: 'You will be logged out shortly. Please check your new email for verification instructions.',
              icon: 'pi-info-circle'
            }
          ]);
          timer(5000)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.logoutMutation.mutate());
        }
      },
      onError: (error: Error & { message?: string }) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Update Failed',
          detail: error?.message || 'Failed to update profile. Please try again.'
        });
      }
    });
  }

  onUploadImage(formData: FormData): void {
    this.uploadProfileImageMutation.mutate(formData, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Profile Image Updated',
          detail: 'Your profile picture has been updated successfully'
        });
      },
      onError: (error: Error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Upload Failed',
          detail: error?.message || 'Failed to upload profile image. Please try again.'
        });
      }
    });
  }
}
