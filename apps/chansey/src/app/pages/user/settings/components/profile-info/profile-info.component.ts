import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { funEmoji } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { MessageService } from 'primeng/api';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { FileSelectEvent, FileUpload, FileUploadModule } from 'primeng/fileupload';
import { FloatLabel } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';

import { IUser, IUserProfileUpdate } from '@chansey/api-interfaces';

import { AuthMessage } from '../../../../../shared/components/auth-messages/auth-message.interface';
import { ImageCropComponent } from '../../../../../shared/components/image-crop/image-crop.component';

@Component({
  selector: 'app-profile-info',
  imports: [
    AvatarModule,
    ButtonModule,
    FileUploadModule,
    FloatLabel,
    FluidModule,
    ImageCropComponent,
    InputTextModule,
    MessageModule,
    ReactiveFormsModule,
    SkeletonModule
  ],
  templateUrl: './profile-info.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  private messageService = inject(MessageService);

  readonly fileUpload = viewChild.required<FileUpload>('fileUpload');

  user = input<IUser>();
  isUpdating = input(false);
  isUploadingImage = input(false);
  messages = input<AuthMessage[]>([]);

  submitProfile = output<Partial<IUserProfileUpdate>>();
  uploadImage = output<FormData>();

  formSubmitted = signal(false);
  showImageCropper = signal(false);
  selectedImageFile = signal<File | null>(null);

  profileForm: FormGroup = this.fb.group({
    given_name: ['', Validators.required],
    family_name: ['', Validators.required],
    email: ['', Validators.compose([Validators.required, Validators.email])]
  });

  userProfileImage = computed(() => {
    const userData = this.user();
    if (!userData) return '';
    const avatar = createAvatar(funEmoji, { seed: userData.id });
    return userData.picture || avatar.toDataUri();
  });

  constructor() {
    effect(() => {
      const userData = this.user();
      if (userData && !this.profileForm.dirty) {
        this.updateForm(userData);
      }
    });
  }

  updateForm(user: IUser): void {
    if (!user) return;
    this.profileForm.patchValue({
      given_name: user.given_name || '',
      family_name: user.family_name || '',
      email: user.email || ''
    });
  }

  onSubmit(): void {
    this.formSubmitted.set(true);
    if (this.profileForm.valid) {
      const profileData = this.profileForm.getRawValue();
      const currentUser = this.user();
      const updatedFields: Partial<IUserProfileUpdate> = {};

      if (currentUser) {
        const userRecord: Record<string, string | null> = {
          given_name: currentUser.given_name,
          family_name: currentUser.family_name,
          email: currentUser.email
        };

        Object.keys(profileData).forEach((key) => {
          if (profileData[key] !== null && profileData[key] !== undefined && profileData[key] !== userRecord[key]) {
            (updatedFields as Record<string, unknown>)[key] = profileData[key];
          }
        });
      }

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
      if (this.fileUpload()) {
        this.fileUpload().clear();
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

  onImageLoadError(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to load image. Please try a different file.'
    });
    this.cancelCropping();
  }

  openFileUpload(): void {
    if (this.fileUpload()) {
      this.fileUpload().basicFileInput?.nativeElement.click();
    }
  }
}
