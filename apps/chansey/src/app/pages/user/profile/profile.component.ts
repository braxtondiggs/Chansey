import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, computed, signal, effect, inject, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { funEmoji } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { DividerModule } from 'primeng/divider';
import { FieldsetModule } from 'primeng/fieldset';
import { FileSelectEvent, FileUpload, FileUploadModule } from 'primeng/fileupload';
import { FloatLabel } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { TabsModule } from 'primeng/tabs';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';

import { ExchangeKey } from '@chansey/api-interfaces';

import { RisksService } from '@chansey-web/app/pages/admin/risks/risks.service';
import { ImageCropComponent } from '@chansey-web/app/shared/components';
import { AuthService, ExchangeService } from '@chansey-web/app/shared/services';
import { PasswordStrengthValidator, PasswordMatchValidator, getPasswordError } from '@chansey-web/app/validators';

import { ProfileService } from './profile.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    AvatarModule,
    ButtonModule,
    CardModule,
    CommonModule,
    ConfirmDialogModule,
    DialogModule,
    DividerModule,
    FieldsetModule,
    FileUploadModule,
    FloatLabel,
    FluidModule,
    ImageCropComponent,
    InputTextModule,
    MessageModule,
    PasswordModule,
    ProgressSpinnerModule,
    ReactiveFormsModule,
    SelectModule,
    SkeletonModule,
    TabsModule,
    TagModule,
    ToastModule,
    TooltipModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './profile.component.html'
})
export class ProfileComponent implements AfterViewInit {
  // Inject dependencies
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private riskService = inject(RisksService);
  private exchangeService = inject(ExchangeService);
  private profileService = inject(ProfileService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private route = inject(ActivatedRoute);

  @ViewChild('fileUpload') fileUpload!: FileUpload;

  messages = signal<any[]>([]);
  showBinanceHelp = signal<boolean>(false);
  showCoinbaseHelp = signal<boolean>(false);
  showImageCropper = signal<boolean>(false);
  selectedImageFile: File | null = null;
  profileForm: FormGroup = this.fb.group({
    given_name: ['', Validators.required],
    family_name: ['', Validators.required],
    email: ['', Validators.compose([Validators.required, Validators.email])],
    risk: ['', Validators.required]
  });
  passwordForm: FormGroup = this.fb.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', Validators.compose([Validators.required, PasswordStrengthValidator()])],
      confirmPassword: ['', [Validators.required]]
    },
    { validators: PasswordMatchValidator }
  );
  uploadedFile: any = null;
  formSubmitted = false;
  passwordFormSubmitted = false;
  croppedImageBlob: Blob | null = null;

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

  // TanStack Query hooks
  private readonly userQuery = this.authService.useUser();
  private readonly logoutMutation = this.authService.useLogoutMutation();
  readonly risksQuery = this.riskService.useRisks();
  readonly supportedExchangesQuery = this.exchangeService.useSupportedExchanges();
  readonly updateProfileMutation = this.profileService.useUpdateProfileMutation();
  readonly uploadProfileImageMutation = this.profileService.useUploadProfileImageMutation();
  readonly changePasswordMutation = this.profileService.useChangePasswordMutation();
  readonly saveExchangeKeysMutation = this.profileService.useSaveExchangeKeysMutation();
  readonly deleteExchangeKeyMutation = this.profileService.useDeleteExchangeKeyMutation();

  // Computed signals for user data
  user = computed(() => this.userQuery.data());
  isLoading = computed(() => this.userQuery.isLoading());

  constructor() {
    // Setup effects to update forms when user data changes
    effect(() => {
      const userData = this.user();
      if (userData && !this.profileForm.dirty) {
        this.updateForms(userData);
      }
    });

    effect(() => {
      const exchanges = this.supportedExchangesQuery.data();
      if (exchanges) {
        // Create dynamic forms for each supported exchange
        const userData = this.user();
        if (userData) {
          exchanges.forEach((exchange) => {
            const exchangeKey = exchange.slug;
            const isConnected = !!userData.exchanges?.find((key: ExchangeKey) => key.exchangeId === exchange.id);

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
      }
    });
  }

  userProfileImage = computed(() => {
    const user = this.user();
    if (!user) return '';

    const avatar = createAvatar(funEmoji, {
      seed: user.id
    });
    return user.picture || avatar.toDataUri();
  });

  userName = computed(() => {
    const user = this.user();
    if (!user) return '';
    return `${user.given_name || ''} ${user.family_name || ''}`.trim();
  });

  userEmail = computed(() => {
    const user = this.user();
    return user?.email || '';
  });

  ngAfterViewInit(): void {
    setTimeout(() => {
      const fragment = this.route.snapshot.fragment;
      if (fragment) {
        const element = document.getElementById(fragment);
        if (element) {
          const isPWA = window.matchMedia('(display-mode: standalone)').matches;
          if (isPWA) {
            // PWA scrolling with fallback - force scroll with explicit coordinates
            const elementRect = element.getBoundingClientRect();
            const absoluteElementTop = elementRect.top + window.pageYOffset;
            const middle = absoluteElementTop - window.innerHeight / 2;
            window.scrollTo({ top: middle, behavior: 'smooth' });
          } else {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }

          // Add visual highlighting after scroll
          this.highlightElement(element);
        }
      }
    }, 500);
  }

  private highlightElement(element: HTMLElement): void {
    const targetElement = (element.firstElementChild as HTMLElement) || element;

    const originalBg = targetElement.style.backgroundColor;
    const originalTransition = targetElement.style.transition;

    targetElement.style.transition = 'background-color 0.3s ease';
    targetElement.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';

    setTimeout(() => {
      targetElement.style.backgroundColor = originalBg;
      setTimeout(() => {
        targetElement.style.transition = originalTransition;
      }, 600);
    }, 1200);
  }

  isExchangeActive(exchangeId: string): boolean {
    const user = this.user();
    return !!user?.exchanges?.find((ex: ExchangeKey) => ex.exchangeId === exchangeId)?.isActive;
  }

  getPasswordError(controlName: string): string {
    return getPasswordError(this.passwordForm, controlName, this.passwordFormSubmitted);
  }

  onSubmit(): void {
    this.formSubmitted = true;
    if (this.profileForm.valid) {
      // Prepare JSON data for API submission
      const profileData = this.profileForm.getRawValue();
      const currentUser = this.user();
      const updatedFields: any = {};
      const isEmailChanged = profileData.email !== currentUser?.email;

      Object.keys(profileData).forEach((key) => {
        if (
          profileData[key] !== null &&
          profileData[key] !== undefined &&
          profileData[key] !== (currentUser as Record<string, any>)[key]
        ) {
          updatedFields[key] = profileData[key];
        }
      });

      if (Object.keys(updatedFields).length === 0) return;

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
      const passwordData = {
        old_password: this.passwordForm.get('currentPassword')?.value,
        new_password: this.passwordForm.get('newPassword')?.value,
        confirm_new_password: this.passwordForm.get('confirmPassword')?.value
      };

      // Use the TanStack mutation
      this.changePasswordMutation.mutate(passwordData, {
        onSuccess: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Password Changed',
            detail: 'Your password has been updated successfully'
          });
          this.passwordForm.reset();
          this.passwordFormSubmitted = false;
        },
        onError: (error: any) => {
          let errorMessage = 'Failed to update password. Please try again.';

          if (error.status === 400) {
            errorMessage = 'Invalid password. Please check your inputs and try again.';
          }

          this.messageService.add({
            severity: 'error',
            summary: 'Password Change Failed',
            detail: errorMessage
          });
        }
      });
    }
  }

  private processProfileUpdate(updatedFields: any, isEmailChanged: boolean): void {
    // No need to handle profile image here, it's uploaded separately

    // Use TanStack mutation
    this.updateProfileMutation.mutate(updatedFields, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Profile Updated',
          detail: 'Your profile information has been updated successfully'
        });

        this.profileForm.markAsPristine();
        this.formSubmitted = false;

        if (isEmailChanged) {
          this.messages.set([
            {
              severity: 'info',
              content: 'You will be logged out shortly. Please check your new email for verification instructions.',
              icon: 'pi-info-circle'
            }
          ]);

          setTimeout(() => {
            this.logoutMutation.mutate();
          }, 5000);
        }
      },
      onError: (error: any) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Update Failed',
          detail: error?.message || 'Failed to update profile. Please try again.'
        });
      }
    });
  }

  onUpload(event: FileSelectEvent): void {
    if (event.currentFiles && event.currentFiles.length > 0) {
      // Instead of uploading directly, open the cropper
      this.selectedImageFile = event.currentFiles[0];
      this.showImageCropper.set(true);

      // Clear the file upload component
      if (this.fileUpload) {
        this.fileUpload.clear();
      }
    }
  }

  handleCroppedImage(croppedImage: Blob): void {
    // Create FormData object to send the cropped blob
    const formData = new FormData();
    const fileName = this.selectedImageFile?.name || 'profile-image.png';
    const croppedFile = new File([croppedImage], fileName, {
      type: croppedImage.type || 'image/png'
    });

    formData.append('file', croppedFile);

    // Upload the cropped image using the file upload endpoint
    this.uploadProfileImageMutation.mutate(formData, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Profile Image Updated',
          detail: 'Your profile picture has been updated successfully'
        });

        // Reset state
        this.selectedImageFile = null;
        this.showImageCropper.set(false);
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

  cancelCropping(): void {
    // Reset state when user cancels cropping
    this.selectedImageFile = null;
    this.showImageCropper.set(false);
  }

  onSaveExchangeKeys(exchangeKey: string): void {
    const exchange = this.exchangeForms[exchangeKey];
    if (!exchange) return;

    exchange.submitted = true;
    if (exchange.form.valid) {
      exchange.loading = true;
      const formData = exchange.form.getRawValue();

      // Find the exchange object
      const exchangeObj = this.supportedExchangesQuery.data()?.find((ex) => ex.slug === exchangeKey);
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
        const userData = this.user();
        const existingKey = userData?.exchanges?.find((ex: ExchangeKey) => ex.exchangeId === exchangeObj.id);

        if (!existingKey || !existingKey.id) {
          this.messageService.add({
            severity: 'error',
            summary: 'Update Failed',
            detail: `Could not find existing keys for ${exchangeObj.name}.`
          });
          exchange.loading = false;
          return;
        }

        // Step 1: Remove the existing key using TanStack mutation
        this.deleteExchangeKeyMutation.mutate(existingKey.id, {
          onSuccess: () => {
            // Step 2: Add the new key
            this.addNewExchangeKey(exchange, exchangeObj, formData);
          },
          onError: (error: any) => {
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

  // Helper method to add a new exchange key using TanStack Query
  private addNewExchangeKey(exchange: any, exchangeObj: any, formData: any): void {
    const exchangeKeyDto = {
      exchangeId: exchangeObj.id,
      apiKey: formData.apiKey,
      secretKey: formData.secretKey,
      isActive: true
    };

    this.saveExchangeKeysMutation.mutate(exchangeKeyDto, {
      onSuccess: ({ isActive }) => {
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
      onError: (error: any) => {
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
    const exchangeObj = this.supportedExchangesQuery.data()?.find((ex) => ex.slug === exchangeKey);
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
    const userData = this.user();
    if (userData) {
      const exchangeObj = this.supportedExchangesQuery.data()?.find((ex) => ex.slug === exchangeKey);
      const isConnected = !!userData?.exchanges?.find((key: ExchangeKey) => key.exchangeId === exchangeObj?.id);

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
    const exchangeObj = this.supportedExchangesQuery.data()?.find((ex) => ex.slug === exchangeKey);
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
        const userData = this.user();
        const exchangeKeyData = userData?.exchanges?.find((ex: ExchangeKey) => ex.exchangeId === exchangeObj?.id);

        if (!exchangeKeyData || !exchangeKeyData.id) {
          this.messageService.add({
            severity: 'error',
            summary: 'Disconnection Failed',
            detail: `Could not find exchange key for ${exchangeName}.`
          });
          exchange.loading = false;
          return;
        }

        // Use the TanStack mutation for deleting exchange key
        this.deleteExchangeKeyMutation.mutate(exchangeKeyData.id, {
          onSuccess: () => {
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
          onError: (error: any) => {
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

  // Update forms with user data
  private updateForms(user: any): void {
    if (!user) return;

    // Update profile form
    this.profileForm?.patchValue({
      given_name: user.given_name || '',
      family_name: user.family_name || '',
      email: user.email || '',
      risk: user.risk?.id || ''
    });

    // Update exchange forms if they exist
    if (user.exchanges && this.exchangeForms) {
      const exchanges = this.supportedExchangesQuery.data() || [];
      exchanges.forEach((exchange) => {
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

  isBinanceUs(exchangeName: string): boolean {
    // Check if the exchange is Binance US
    return exchangeName?.toLowerCase().includes('binance us');
  }

  isCoinbase(exchangeName: string): boolean {
    // Check if the exchange is Coinbase
    return exchangeName?.toLowerCase().includes('coinbase');
  }

  toggleBinanceHelp(): void {
    this.showBinanceHelp.set(!this.showBinanceHelp());
  }

  toggleCoinbaseHelp(): void {
    this.showCoinbaseHelp.set(!this.showCoinbaseHelp());
  }

  openFileUpload(): void {
    if (this.fileUpload) {
      this.fileUpload.basicFileInput?.nativeElement.click();
    }
  }
}
