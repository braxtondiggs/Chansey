import { AfterViewInit, Component, computed, DestroyRef, effect, inject, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';

import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { delay, filter } from 'rxjs';

import { ChangePasswordRequest, Exchange, ExchangeKey } from '@chansey/api-interfaces';

import { ChangePasswordComponent } from './components/change-password/change-password.component';
import { ExchangeIntegrationsComponent } from './components/exchange-integrations/exchange-integrations.component';
import { ProfileInfoComponent } from './components/profile-info/profile-info.component';
import { ProfileService } from './profile.service';
import { ExchangeFormState } from './profile.types';

import { AuthMessage } from '../../../shared/components/auth-messages/auth-message.interface';
import { AuthService } from '../../../shared/services/auth.service';
import { ExchangeService } from '../../../shared/services/exchange.service';
import { RisksService } from '../../admin/risks/risks.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    ChangePasswordComponent,
    ConfirmDialogModule,
    ExchangeIntegrationsComponent,
    ProfileInfoComponent,
    ToastModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './profile.component.html',
  styles: `
    @keyframes highlight-flash {
      0% {
        background-color: rgba(59, 130, 246, 0.2);
      }
      100% {
        background-color: transparent;
      }
    }
    :host ::ng-deep .highlight-flash {
      animation: highlight-flash 1.8s ease-out;
    }
  `
})
export class ProfileComponent implements AfterViewInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private riskService = inject(RisksService);
  private exchangeService = inject(ExchangeService);
  private profileService = inject(ProfileService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private logoutMutation = this.authService.useLogoutMutation();
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  @ViewChild('profileInfo') profileInfo!: ProfileInfoComponent;
  @ViewChild('changePasswordRef') changePasswordRef!: ChangePasswordComponent;

  messages = signal<AuthMessage[]>([]);
  exchangeForms = signal<Record<string, ExchangeFormState>>({});

  // TanStack Query hooks
  private readonly userQuery = this.authService.useUser();
  readonly risksQuery = this.riskService.useRisks();
  readonly supportedExchangesQuery = this.exchangeService.useSupportedExchanges();
  readonly updateProfileMutation = this.profileService.useUpdateProfileMutation();
  readonly uploadProfileImageMutation = this.profileService.useUploadProfileImageMutation();
  readonly changePasswordMutation = this.profileService.useChangePasswordMutation();
  readonly saveExchangeKeysMutation = this.profileService.useSaveExchangeKeysMutation();
  readonly deleteExchangeKeyMutation = this.profileService.useDeleteExchangeKeyMutation();

  user = computed(() => this.userQuery.data());
  isLoading = computed(() => this.userQuery.isLoading());

  constructor() {
    // Build exchange forms when exchanges + user data are available
    effect(() => {
      const exchanges = this.supportedExchangesQuery.data();
      const userData = this.user();
      if (!exchanges || !userData) return;

      this.exchangeForms.update((current) => {
        const updated = { ...current };
        exchanges.forEach((exchange: Exchange) => {
          const slug = exchange.slug;
          const matchedKey = userData.exchanges?.find((key: ExchangeKey) => key.exchangeId === exchange.id);
          const isConnected = !!matchedKey;

          if (updated[slug]) {
            // Only update connected status, don't destroy form state
            if (!updated[slug].editMode) {
              updated[slug] = { ...updated[slug], connected: isConnected, connectedAt: matchedKey?.createdAt };
              const form = updated[slug].form;
              const apiKey = form.get('apiKey');
              const secretKey = form.get('secretKey');
              if (apiKey && secretKey) {
                if (isConnected) {
                  apiKey.disable();
                  secretKey.disable();
                  form.patchValue({ apiKey: '••••••••••••••••••••••••', secretKey: '••••••••••••••••••••••••' });
                } else {
                  apiKey.enable();
                  secretKey.enable();
                }
              }
            }
          } else {
            updated[slug] = {
              form: this.fb.nonNullable.group({
                apiKey: [
                  { value: isConnected ? '••••••••••••••••••••••••' : '', disabled: isConnected },
                  Validators.required
                ],
                secretKey: [
                  { value: isConnected ? '••••••••••••••••••••••••' : '', disabled: isConnected },
                  Validators.required
                ]
              }),
              connected: isConnected,
              loading: false,
              submitted: false,
              editMode: false,
              name: exchange.name,
              exchangeId: exchange.id,
              slug,
              connectedAt: matchedKey?.createdAt
            };
          }
        });
        return updated;
      });
    });
  }

  ngAfterViewInit(): void {
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        delay(50),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        const fragment = this.route.snapshot.fragment;
        if (fragment) {
          const element = document.getElementById(fragment);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            this.highlightElement(element);
          }
        }
      });
  }

  private highlightElement(element: HTMLElement): void {
    const target = (element.firstElementChild as HTMLElement) || element;
    target.classList.add('highlight-flash');
    setTimeout(() => target.classList.remove('highlight-flash'), 1800);
  }

  // --- Profile Info handlers ---

  onSubmitProfile(updatedFields: Partial<Record<string, unknown>>): void {
    const isEmailChanged = this.profileInfo?.isEmailChanged() ?? false;

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

  private processProfileUpdate(updatedFields: Partial<Record<string, unknown>>, isEmailChanged: boolean): void {
    this.updateProfileMutation.mutate(updatedFields, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Profile Updated',
          detail: 'Your profile information has been updated successfully'
        });
        this.profileInfo?.markAsPristine();

        if (isEmailChanged) {
          this.messages.set([
            {
              severity: 'info',
              content: 'You will be logged out shortly. Please check your new email for verification instructions.',
              icon: 'pi-info-circle'
            }
          ]);
          setTimeout(() => this.logoutMutation.mutate(), 5000);
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

  // --- Change Password handler ---

  onChangePassword(passwordData: ChangePasswordRequest): void {
    this.changePasswordMutation.mutate(passwordData, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Password Changed',
          detail: 'Your password has been updated successfully'
        });
        this.changePasswordRef?.resetForm();
      },
      onError: (error: Error & { status?: number }) => {
        const errorMessage =
          error.status === 400
            ? 'Invalid password. Please check your inputs and try again.'
            : 'Failed to update password. Please try again.';
        this.messageService.add({ severity: 'error', summary: 'Password Change Failed', detail: errorMessage });
      }
    });
  }

  // --- Exchange Key handlers ---

  onSaveExchangeKeys(exchangeSlug: string): void {
    const forms = this.exchangeForms();
    const exchange = forms[exchangeSlug];
    if (!exchange) return;

    this.updateExchangeForm(exchangeSlug, { submitted: true });
    if (!exchange.form.valid) return;

    this.updateExchangeForm(exchangeSlug, { loading: true });
    const formData = exchange.form.getRawValue();

    const exchangeObj = this.supportedExchangesQuery.data()?.find((ex: Exchange) => ex.slug === exchangeSlug);
    if (!exchangeObj) {
      this.messageService.add({
        severity: 'error',
        summary: 'Connection Failed',
        detail: `Could not find exchange with key: ${exchangeSlug}`
      });
      this.updateExchangeForm(exchangeSlug, { loading: false });
      return;
    }

    if (exchange.editMode) {
      const userData = this.user();
      const existingKey = userData?.exchanges?.find((ex: ExchangeKey) => ex.exchangeId === exchangeObj.id);
      if (!existingKey?.id) {
        this.messageService.add({
          severity: 'error',
          summary: 'Update Failed',
          detail: `Could not find existing keys for ${exchangeObj.name}.`
        });
        this.updateExchangeForm(exchangeSlug, { loading: false });
        return;
      }

      this.updateExchangeForm(exchangeSlug, { loading: false });
      this.confirmationService.confirm({
        message:
          "Updating exchange keys will briefly disconnect your exchange. If the new keys fail validation, you'll need to re-enter them.",
        header: 'Update Exchange Keys',
        icon: 'pi pi-exclamation-triangle',
        accept: () => {
          this.updateExchangeForm(exchangeSlug, { loading: true });
          this.deleteExchangeKeyMutation.mutate(existingKey.id, {
            onSuccess: () => this.addNewExchangeKey(exchangeSlug, exchangeObj, formData),
            onError: (error: Error & { error?: { message?: string } }) => {
              this.updateExchangeForm(exchangeSlug, { loading: false });
              this.messageService.add({
                severity: 'error',
                summary: 'Update Failed',
                detail:
                  error.error?.message || `Failed to remove existing keys for ${exchangeObj.name}. Please try again.`
              });
            }
          });
        },
        reject: () => {
          this.updateExchangeForm(exchangeSlug, { loading: false });
        }
      });
    } else {
      this.addNewExchangeKey(exchangeSlug, exchangeObj, formData);
    }
  }

  private addNewExchangeKey(
    exchangeSlug: string,
    exchangeObj: Exchange,
    formData: { apiKey: string; secretKey: string }
  ): void {
    const exchangeKeyDto = {
      exchangeId: exchangeObj.id,
      apiKey: formData.apiKey,
      secretKey: formData.secretKey,
      isActive: true
    };

    this.saveExchangeKeysMutation.mutate(exchangeKeyDto, {
      onSuccess: ({ isActive }) => {
        this.updateExchangeForm(exchangeSlug, { connected: true, loading: false, editMode: false });
        this.messageService.add({
          severity: isActive ? 'success' : 'error',
          summary: isActive ? 'Connection Successful' : 'Connection Failed',
          detail: isActive
            ? `Your ${exchangeObj.name} account has been connected successfully`
            : `Failed to connect to ${exchangeObj.name}. Please check your API keys and try again.`
        });
      },
      onError: (error: Error & { status?: number; error?: { message?: string } }) => {
        this.updateExchangeForm(exchangeSlug, { loading: false });
        const detail =
          error.status === 409
            ? 'You already have API keys for this exchange. Please remove the existing keys before adding new ones.'
            : error.error?.message ||
              `Failed to connect to ${exchangeObj.name}. Please check your API keys and try again.`;
        this.messageService.add({ severity: 'error', summary: 'Connection Failed', detail });
      }
    });
  }

  onEditExchangeKeys(exchangeSlug: string): void {
    const forms = this.exchangeForms();
    const exchange = forms[exchangeSlug];
    if (!exchange) return;

    const apiKey = exchange.form.get('apiKey');
    const secretKey = exchange.form.get('secretKey');
    if (apiKey && secretKey) {
      apiKey.enable();
      secretKey.enable();
      exchange.form.patchValue({ apiKey: '', secretKey: '' });
    }
    this.updateExchangeForm(exchangeSlug, { editMode: true });
  }

  onCancelEditExchangeKeys(exchangeSlug: string): void {
    const forms = this.exchangeForms();
    const exchange = forms[exchangeSlug];
    if (!exchange) return;

    const userData = this.user();
    const exchangeObj = this.supportedExchangesQuery.data()?.find((ex: Exchange) => ex.slug === exchangeSlug);
    const isConnected = !!userData?.exchanges?.find((key: ExchangeKey) => key.exchangeId === exchangeObj?.id);

    const apiKey = exchange.form.get('apiKey');
    const secretKey = exchange.form.get('secretKey');
    if (apiKey && secretKey) {
      exchange.form.patchValue({
        apiKey: isConnected ? '••••••••••••••••••••••••' : '',
        secretKey: isConnected ? '••••••••••••••••••••••••' : ''
      });
      apiKey.disable();
      secretKey.disable();
    }
    this.updateExchangeForm(exchangeSlug, { editMode: false, submitted: false });
  }

  onRemoveExchangeKeys(exchangeSlug: string): void {
    const forms = this.exchangeForms();
    const exchange = forms[exchangeSlug];
    if (!exchange) return;

    const exchangeObj = this.supportedExchangesQuery.data()?.find((ex: Exchange) => ex.slug === exchangeSlug);
    const exchangeName = exchangeObj?.name || exchangeSlug;

    this.confirmationService.confirm({
      message: `Are you sure you want to disconnect your ${exchangeName} account? This will remove your API keys.`,
      header: 'Disconnect Exchange',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        this.updateExchangeForm(exchangeSlug, { loading: true });
        const userData = this.user();
        const exchangeKeyData = userData?.exchanges?.find((ex: ExchangeKey) => ex.exchangeId === exchangeObj?.id);

        if (!exchangeKeyData?.id) {
          this.messageService.add({
            severity: 'error',
            summary: 'Disconnection Failed',
            detail: `Could not find exchange key for ${exchangeName}.`
          });
          this.updateExchangeForm(exchangeSlug, { loading: false });
          return;
        }

        this.deleteExchangeKeyMutation.mutate(exchangeKeyData.id, {
          onSuccess: () => {
            this.updateExchangeForm(exchangeSlug, { connected: false, loading: false });
            const form = this.exchangeForms()[exchangeSlug]?.form;
            const apiKey = form?.get('apiKey');
            const secretKey = form?.get('secretKey');
            if (apiKey && secretKey) {
              apiKey.enable();
              secretKey.enable();
              form.patchValue({ apiKey: '', secretKey: '' });
            }
            this.messageService.add({
              severity: 'success',
              summary: 'Exchange Disconnected',
              detail: `Your ${exchangeName} account has been disconnected successfully`
            });
          },
          onError: (error: Error & { error?: { message?: string } }) => {
            this.updateExchangeForm(exchangeSlug, { loading: false });
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

  private updateExchangeForm(slug: string, updates: Partial<ExchangeFormState>): void {
    this.exchangeForms.update((current) => {
      if (!current[slug]) return current;
      return { ...current, [slug]: { ...current[slug], ...updates } };
    });
  }
}
