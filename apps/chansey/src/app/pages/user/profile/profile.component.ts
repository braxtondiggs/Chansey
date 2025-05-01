import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { funEmoji } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { FieldsetModule } from 'primeng/fieldset';
import { FileUploadModule } from 'primeng/fileupload';
import { FloatLabel } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { TabViewModule } from 'primeng/tabview';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';

import { Exchange, ExchangeKey } from '@chansey/api-interfaces';

import { AuthService, ExchangeService } from '@chansey-web/app/services';
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
    FieldsetModule,
    FileUploadModule,
    FloatLabel,
    FluidModule,
    InputTextModule,
    MessageModule,
    PasswordModule,
    ReactiveFormsModule,
    ProgressSpinnerModule,
    SelectModule,
    TabViewModule,
    TagModule,
    ToastModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './profile.component.html'
})
export class ProfileComponent {
  userSignal: any;
  messages = signal<any[]>([]);
  profileForm: FormGroup;
  passwordForm: FormGroup;
  uploadedFile: any = null;
  formSubmitted = false;
  passwordFormSubmitted = false;
  profileLoading = false;
  passwordLoading = false;
  risks = signal<Risk[]>([]);
  supportedExchanges = signal<Exchange[]>([]);
  userState: any = null;
  exchangeForms: Record<
    string,
    {
      form: FormGroup;
      connected: boolean;
      loading: boolean;
      submitted: boolean;
      editMode: boolean;
      name?: string;
    }
  > = {};

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private exchangeService: ExchangeService,
    private profileService: ProfileService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService
  ) {
    this.userSignal = toSignal(this.authService.user$, { initialValue: null });

    // Initialize userState from the current user value
    this.authService.user$.subscribe((user) => {
      if (user) {
        this.userState = { ...user };

        this.loadExchanges();
        this.updateForms(this.userState);
      }
    });

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
    const avatar = createAvatar(funEmoji, {
      seed: user?.['id']
    });
    return user?.['picture'] || avatar.toDataUri();
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

  isExchangeActive(exchangeId: string): boolean {
    const user = this.userSignal();
    return !!user?.exchanges?.find((ex: ExchangeKey) => ex.exchangeId === exchangeId)?.isActive;
  }

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

  private loadExchanges(): void {
    this.exchangeService.getSupportedExchanges().subscribe({
      next: (exchanges) => {
        // Store full Exchange objects in supportedExchanges
        this.supportedExchanges.set(exchanges);

        // Create dynamic forms for each supported exchange
        const user = this.userSignal();
        if (user) {
          exchanges.forEach((exchange) => {
            const exchangeKey = exchange.slug;
            const isConnected = !!user.exchanges?.find((key: ExchangeKey) => key.exchangeId === exchange.id);

            // Create a form for this exchange with masked placeholders if connected
            this.exchangeForms[exchangeKey] = {
              form: this.fb.group({
                apiKey: [
                  {
                    value: isConnected ? '••••••••••••••••••••••••' : '',
                    disabled: isConnected
                  },
                  Validators.required
                ],
                secretKey: [
                  {
                    value: isConnected ? '••••••••••••••••••••••••' : '',
                    disabled: isConnected
                  },
                  Validators.required
                ]
              }),
              connected: isConnected,
              loading: false,
              submitted: false,
              editMode: false,
              name: exchange.name // Store the exchange name for display
            };
          });
        }
      },
      error: (error) => {
        console.error('Error loading exchanges:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Failed to Load Exchanges',
          detail: 'Could not load supported exchanges. Please try again later.'
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

  onSaveExchangeKeys(exchangeKey: string): void {
    const exchange = this.exchangeForms[exchangeKey];
    if (!exchange) return;

    exchange.submitted = true;
    if (exchange.form.valid) {
      exchange.loading = true;
      const formData = exchange.form.getRawValue();

      // Find the exchange object
      const exchangeObj = this.supportedExchanges().find((ex) => ex.slug === exchangeKey);
      if (!exchangeObj) {
        this.messageService.add({
          severity: 'error',
          summary: 'Connection Failed',
          detail: `Could not find exchange with key: ${exchangeKey}`
        });
        exchange.loading = false;
        return;
      }

      // If we're in edit mode, first remove the existing key then add the new one
      if (exchange.editMode) {
        // Find the existing exchange key ID
        const user = this.userSignal();
        const existingKey = user?.exchanges?.find((ex: ExchangeKey) => ex.exchangeId === exchangeObj.id);

        if (!existingKey || !existingKey.id) {
          this.messageService.add({
            severity: 'error',
            summary: 'Update Failed',
            detail: `Could not find existing keys for ${exchangeObj.name}.`
          });
          exchange.loading = false;
          return;
        }

        // Step 1: Remove the existing key
        this.profileService.deleteExchangeKey(existingKey.id).subscribe({
          next: () => {
            // Step 2: Add the new key
            this.addNewExchangeKey(exchange, exchangeObj, formData);
          },
          error: (error) => {
            exchange.loading = false;
            this.messageService.add({
              severity: 'error',
              summary: 'Update Failed',
              detail:
                error.error?.message || `Failed to remove existing keys for ${exchangeObj.name}. Please try again.`
            });
          }
        });
      } else {
        // Not in edit mode, just add the key
        this.addNewExchangeKey(exchange, exchangeObj, formData);
      }
    }
  }

  // Helper method to add a new exchange key
  private addNewExchangeKey(exchange: any, exchangeObj: any, formData: any): void {
    const exchangeKeyDto = {
      exchangeId: exchangeObj.id,
      apiKey: formData.apiKey,
      secretKey: formData.secretKey,
      isActive: true
    };

    this.profileService.saveExchangeKeys(exchangeKeyDto).subscribe({
      next: ({ isActive }) => {
        exchange.connected = true;
        exchange.loading = false;
        exchange.editMode = false; // Exit edit mode after successful save

        this.messageService.add({
          severity: isActive ? 'success' : 'error',
          summary: isActive ? 'Connection Successful' : 'Connection Failed',
          detail: isActive
            ? `Your ${exchangeObj.name} account has been connected successfully`
            : `Failed to connect to ${exchangeObj.name}. Please check your API keys and try again.`
        });
      },
      error: (error) => {
        exchange.loading = false;

        // Handle the specific conflict error when a key already exists
        if (error.status === 409) {
          this.messageService.add({
            severity: 'error',
            summary: 'Connection Failed',
            detail: `You already have API keys for this exchange. Please remove the existing keys before adding new ones.`
          });
        } else {
          this.messageService.add({
            severity: 'error',
            summary: 'Connection Failed',
            detail:
              error.error?.message ||
              `Failed to connect to ${exchangeObj.name}. Please check your API keys and try again.`
          });
        }
      }
    });
  }

  toggleEditExchangeKeys(exchangeKey: string): void {
    const exchange = this.exchangeForms[exchangeKey];
    if (!exchange) return;

    exchange.editMode = true;

    // Get the exchange object
    const exchangeObj = this.supportedExchanges().find((ex) => ex.slug === exchangeKey);
    if (!exchangeObj) return;

    // Enable the form controls and clear the values
    const apiKeyControl = exchange.form.get('apiKey');
    const secretKeyControl = exchange.form.get('secretKey');

    if (apiKeyControl && secretKeyControl) {
      apiKeyControl.enable();
      secretKeyControl.enable();

      // Clear the form fields when entering edit mode
      exchange.form.patchValue({
        apiKey: '',
        secretKey: ''
      });
    }
  }

  cancelEditExchangeKeys(exchangeKey: string): void {
    const exchange = this.exchangeForms[exchangeKey];
    if (!exchange) return;

    exchange.editMode = false;
    exchange.submitted = false;

    // Reset the form values to placeholder values and disable controls
    const user = this.userSignal();
    if (user) {
      console.log('exchangeKey', exchangeKey);
      const isConnected = !!user.exchanges.find((key: ExchangeKey) => key.slug === exchangeKey);

      const apiKeyControl = exchange.form.get('apiKey');
      const secretKeyControl = exchange.form.get('secretKey');

      if (apiKeyControl && secretKeyControl) {
        exchange.form.patchValue({
          apiKey: isConnected ? '••••••••••••••••••••••••' : '',
          secretKey: isConnected ? '••••••••••••••••••••••••' : ''
        });

        apiKeyControl.disable();
        secretKeyControl.disable();
      }
    }
  }

  removeExchangeKeys(exchangeKey: string): void {
    const exchange = this.exchangeForms[exchangeKey];
    if (!exchange) return;

    // Get the exchange name for display in confirmation dialog
    const exchangeObj = this.supportedExchanges().find((ex) => ex.slug === exchangeKey);
    const exchangeName = exchangeObj?.name || exchangeKey;

    this.confirmationService.confirm({
      message: `Are you sure you want to disconnect your ${exchangeName} account? This will remove your API keys.`,
      header: 'Disconnect Exchange',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        exchange.loading = true;

        // Find the exchange key ID for the exchange we want to delete
        const user = this.userSignal();
        const exchangeKeyData = user?.exchanges?.find((ex: ExchangeKey) => ex.exchangeId === exchangeObj?.id);

        if (!exchangeKeyData || !exchangeKeyData.exchangeId) {
          this.messageService.add({
            severity: 'error',
            summary: 'Disconnection Failed',
            detail: `Could not find exchange key for ${exchangeName}.`
          });
          exchange.loading = false;
          return;
        }

        // Use the new deleteExchangeKey method to properly remove the exchange key
        this.profileService.deleteExchangeKey(exchangeKeyData.id).subscribe({
          next: () => {
            exchange.connected = false;
            exchange.loading = false;

            // Reset and enable the form for new keys
            const apiKeyControl = exchange.form.get('apiKey');
            const secretKeyControl = exchange.form.get('secretKey');

            if (apiKeyControl && secretKeyControl) {
              apiKeyControl.enable();
              secretKeyControl.enable();

              exchange.form.patchValue({
                apiKey: '',
                secretKey: ''
              });
            }

            this.messageService.add({
              severity: 'success',
              summary: 'Exchange Disconnected',
              detail: `Your ${exchangeName} account has been disconnected successfully`
            });
          },
          error: (error) => {
            exchange.loading = false;
            this.messageService.add({
              severity: 'error',
              summary: 'Disconnection Failed',
              detail: error.error?.message || `Failed to disconnect ${exchangeName}. Please try again.`
            });
          }
        });
      }
    });
  }

  // Add the updateForms method to immediately update form data
  private updateForms(user: any): void {
    if (!user) return;

    // Update profile form
    this.profileForm?.patchValue({
      given_name: user['given_name'] || '',
      family_name: user['family_name'] || '',
      email: user['email'] || '',
      risk: user.risk?.id || ''
    });

    // Update exchange forms if they exist
    if (user.exchanges && this.exchangeForms) {
      this.supportedExchanges().forEach((exchange) => {
        const exchangeKey = exchange.slug;
        const exchangeForm = this.exchangeForms[exchangeKey];
        if (exchangeForm) {
          const isConnected = !!user.exchanges.find((key: ExchangeKey) => key.exchangeId === exchange.id);
          exchangeForm.connected = isConnected;

          // Only update the form controls if they're not in edit mode
          if (!exchangeForm.editMode) {
            const apiKeyControl = exchangeForm.form.get('apiKey');
            const secretKeyControl = exchangeForm.form.get('secretKey');

            if (apiKeyControl && secretKeyControl) {
              if (isConnected) {
                apiKeyControl.disable();
                secretKeyControl.disable();
                exchangeForm.form.patchValue({
                  apiKey: '••••••••••••••••••••••••',
                  secretKey: '••••••••••••••••••••••••'
                });
              } else {
                apiKeyControl.enable();
                secretKeyControl.enable();
              }
            }
          }
        }
      });
    }
  }
}
