import { Component, computed, effect, inject, input, output, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { funEmoji } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { FileSelectEvent, FileUpload, FileUploadModule } from 'primeng/fileupload';
import { FloatLabel } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PanelModule } from 'primeng/panel';
import { ProgressBar } from 'primeng/progressbar';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';

import { IUser, IUserProfileUpdate, Risk, TRADING_STYLE_PROFILES, TradingStyleProfile } from '@chansey/api-interfaces';

import { AuthMessage } from '../../../../../shared/components/auth-messages/auth-message.interface';
import { ImageCropComponent } from '../../../../../shared/components/image-crop/image-crop.component';

@Component({
  selector: 'app-profile-info',
  standalone: true,
  imports: [
    AvatarModule,
    ButtonModule,
    CardModule,
    FileUploadModule,
    FloatLabel,
    FluidModule,
    ImageCropComponent,
    InputTextModule,
    MessageModule,
    PanelModule,
    ProgressBar,
    ReactiveFormsModule,
    SelectModule,
    SkeletonModule,
    TooltipModule
  ],
  templateUrl: './profile-info.component.html',
  styles: `
    .p-avatar.profile {
      width: 20rem;
      height: fit-content;
    }
    @media (max-width: 639px) {
      .p-avatar.profile {
        width: 100%;
        max-width: 20rem;
      }
    }
  `
})
export class ProfileInfoComponent {
  private fb = inject(FormBuilder);

  @ViewChild('fileUpload') fileUpload!: FileUpload;

  user = input<IUser>();
  risks = input<Risk[]>();
  risksLoading = input(false);
  risksError = input(false);
  isUpdating = input(false);
  isUploadingImage = input(false);
  messages = input<AuthMessage[]>([]);

  submitProfile = output<Partial<IUserProfileUpdate>>();
  uploadImage = output<FormData>();

  formSubmitted = signal(false);
  showImageCropper = signal(false);
  selectedImageFile = signal<File | null>(null);

  readonly DAILY_LOSS_LIMIT_SCALE = 5;
  readonly BEAR_MARKET_CAPITAL_SCALE = 4;

  profileForm: FormGroup = this.fb.group({
    given_name: ['', Validators.required],
    family_name: ['', Validators.required],
    email: ['', Validators.compose([Validators.required, Validators.email])],
    coinRisk: ['', Validators.required],
    calculationRiskLevel: [null]
  });

  calculationRiskOptions = [
    { label: 'Ultra Conservative', value: 1 },
    { label: 'Conservative', value: 2 },
    { label: 'Moderate', value: 3 },
    { label: 'Growth', value: 4 },
    { label: 'Aggressive', value: 5 }
  ];

  selectedCoinRiskId = signal<string | null>(null);
  selectedCalcRiskLevel = signal<number | null>(null);

  tradingStyleProfile = computed<TradingStyleProfile | null>(() => {
    const calcRisk = this.selectedCalcRiskLevel();
    const risks = this.risks();
    const selectedId = this.selectedCoinRiskId();
    if (!risks || !selectedId) return null;
    const selected = risks.find((r: Risk) => r.id === selectedId);
    if (!selected) return null;
    const level = calcRisk ?? selected.level;
    return TRADING_STYLE_PROFILES[level] ?? TRADING_STYLE_PROFILES[3];
  });

  userProfileImage = computed(() => {
    const userData = this.user();
    if (!userData) return '';
    const avatar = createAvatar(funEmoji, { seed: userData.id });
    return userData.picture || avatar.toDataUri();
  });

  constructor() {
    this.profileForm
      .get('coinRisk')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((v) => {
        this.selectedCoinRiskId.set(v);
        // Auto-default Trading Style to match Portfolio Pool level
        const risks = this.risks();
        const selected = risks?.find((r: Risk) => r.id === v);
        if (selected && selected.level >= 1 && selected.level <= 5) {
          this.profileForm.get('calculationRiskLevel')?.setValue(selected.level);
        }
      });
    this.profileForm
      .get('calculationRiskLevel')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((v) => this.selectedCalcRiskLevel.set(v));

    // Reactively populate form when user input changes
    effect(() => {
      const userData = this.user();
      if (userData && !this.profileForm.dirty) {
        this.updateForm(userData);
      }
    });
  }

  updateForm(user: IUser): void {
    if (!user) return;
    const userAny = user as unknown as Record<string, unknown>;
    const coinRiskObj = userAny['coinRisk'] as { id: string; level?: number } | undefined;
    // Default calculationRiskLevel to coinRisk level when not explicitly set
    const calcLevel = user.calculationRiskLevel ?? coinRiskObj?.level ?? null;
    this.profileForm.patchValue({
      given_name: user.given_name || '',
      family_name: user.family_name || '',
      email: user.email || '',
      coinRisk: coinRiskObj?.id || '',
      calculationRiskLevel: calcLevel
    });
    this.selectedCoinRiskId.set(coinRiskObj?.id || null);
    this.selectedCalcRiskLevel.set(calcLevel);
  }

  onSubmit(): void {
    this.formSubmitted.set(true);
    if (this.profileForm.valid) {
      const profileData = this.profileForm.getRawValue();
      const currentUser = this.user();
      const userAny = currentUser as unknown as Record<string, unknown> | undefined;
      const updatedFields: Partial<IUserProfileUpdate> = {};

      // Build a normalized record for comparison, extracting coinRisk.id
      const normalizedUser: Record<string, unknown> = {};
      if (userAny) {
        Object.keys(profileData).forEach((key) => {
          if (key === 'coinRisk') {
            const coinRiskObj = userAny['coinRisk'] as { id: string } | undefined;
            normalizedUser[key] = coinRiskObj?.id || '';
          } else if (key === 'calculationRiskLevel') {
            const coinRiskObj = userAny['coinRisk'] as { level?: number } | undefined;
            normalizedUser[key] = userAny['calculationRiskLevel'] ?? coinRiskObj?.level ?? null;
          } else {
            normalizedUser[key] = userAny[key];
          }
        });
      }

      Object.keys(profileData).forEach((key) => {
        if (profileData[key] !== null && profileData[key] !== undefined && profileData[key] !== normalizedUser[key]) {
          (updatedFields as Record<string, unknown>)[key] = profileData[key];
        }
      });

      if (Object.keys(updatedFields).length === 0) return;
      this.submitProfile.emit(updatedFields);
    }
  }

  markAsPristine(): void {
    this.profileForm.markAsPristine();
    this.formSubmitted.set(false);
  }

  isEmailChanged(): boolean {
    const profileData = this.profileForm.getRawValue();
    return profileData.email !== this.user()?.email;
  }

  onUpload(event: FileSelectEvent): void {
    if (event.currentFiles && event.currentFiles.length > 0) {
      this.selectedImageFile.set(event.currentFiles[0]);
      this.showImageCropper.set(true);
      if (this.fileUpload) {
        this.fileUpload.clear();
      }
    }
  }

  handleCroppedImage(croppedImage: Blob): void {
    const formData = new FormData();
    const fileName = this.selectedImageFile()?.name || 'profile-image.png';
    const croppedFile = new File([croppedImage], fileName, {
      type: croppedImage.type || 'image/png'
    });
    formData.append('file', croppedFile);
    this.uploadImage.emit(formData);
    this.selectedImageFile.set(null);
    this.showImageCropper.set(false);
  }

  cancelCropping(): void {
    this.selectedImageFile.set(null);
    this.showImageCropper.set(false);
  }

  openFileUpload(): void {
    if (this.fileUpload) {
      this.fileUpload.basicFileInput?.nativeElement.click();
    }
  }
}
