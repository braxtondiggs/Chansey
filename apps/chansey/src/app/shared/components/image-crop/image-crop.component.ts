
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { ImageCroppedEvent, ImageCropperComponent, LoadedImage } from 'ngx-image-cropper';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';

@Component({
  selector: 'app-image-crop',
  standalone: true,
  imports: [ImageCropperComponent, DialogModule, ButtonModule],
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: '450px', height: '550px' }"
      [draggable]="false"
      [resizable]="false"
      header="Crop Profile Image"
      [closable]="false"
    >
      <div class="flex h-full flex-col">
        <p class="text-600 mb-3 text-sm">Please crop your image to create a square profile picture.</p>
        <div class="flex flex-1 items-center justify-center overflow-hidden">
          <image-cropper
            [imageFile]="imageFile ?? undefined"
            [maintainAspectRatio]="true"
            [aspectRatio]="1 / 1"
            [roundCropper]="true"
            [canvasRotation]="canvasRotation"
            [transform]="transform"
            (imageCropped)="imageCropped($event)"
            (imageLoaded)="imageLoaded($event)"
            (cropperReady)="cropperReady()"
            (loadImageFailed)="loadImageFailed()"
            format="png"
            outputType="blob"
          ></image-cropper>
        </div>

        <div class="mt-3 flex flex-col gap-4">
          <div class="flex justify-center gap-2">
            <button
              pButton
              type="button"
              icon="pi pi-refresh"
              class="p-button-rounded p-button-outlined"
              (click)="rotateLeft()"
            ></button>
            <button
              pButton
              type="button"
              icon="pi pi-refresh p-button-rotate-right"
              class="p-button-rounded p-button-outlined"
              (click)="rotateRight()"
            ></button>
            <button
              pButton
              type="button"
              icon="pi pi-arrows-h"
              class="p-button-rounded p-button-outlined"
              (click)="flipHorizontal()"
            ></button>
            <button
              pButton
              type="button"
              icon="pi pi-arrows-v"
              class="p-button-rounded p-button-outlined"
              (click)="flipVertical()"
            ></button>
          </div>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <button pButton type="button" label="Cancel" class="p-button-text" (click)="cancelCrop()"></button>
        <button pButton type="button" label="Apply" (click)="applyCrop()" [disabled]="!croppedImage"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      :host ::ng-deep .p-button-rotate-right {
        transform: scaleX(-1);
      }
    `
  ]
})
export class ImageCropComponent {
  @Input() visible = false;
  @Input() imageFile: File | null = null;

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() croppedImageChange = new EventEmitter<Blob>();
  // eslint-disable-next-line @angular-eslint/no-output-native
  @Output() cancel = new EventEmitter<void>();

  croppedImage: Blob | null = null;
  canvasRotation = 0;
  transform: { flipH: boolean; flipV: boolean; rotate: number } = {
    flipH: false,
    flipV: false,
    rotate: 0
  };

  imageCropped(event: ImageCroppedEvent) {
    if (event.blob) {
      this.croppedImage = event.blob;
    }
  }

  imageLoaded(image: LoadedImage) {
    // You can perform actions when the image is loaded
  }

  cropperReady() {
    // Cropper is ready to be interacted with
  }

  loadImageFailed() {
    // Show an error message to the user
  }

  rotateLeft() {
    this.canvasRotation--;
    this.flipAfterRotate();
  }

  rotateRight() {
    this.canvasRotation++;
    this.flipAfterRotate();
  }

  flipHorizontal() {
    this.transform = {
      ...this.transform,
      flipH: !this.transform.flipH
    };
  }

  flipVertical() {
    this.transform = {
      ...this.transform,
      flipV: !this.transform.flipV
    };
  }

  // Maintains the flip state after rotation
  private flipAfterRotate() {
    const flippedH = this.transform.flipH;
    const flippedV = this.transform.flipV;
    this.transform = {
      ...this.transform,
      flipH: flippedV,
      flipV: flippedH
    };
  }

  applyCrop() {
    if (this.croppedImage) {
      this.croppedImageChange.emit(this.croppedImage);
      this.closeDialog();
    }
  }

  cancelCrop() {
    this.cancel.emit();
    this.closeDialog();
  }

  private closeDialog() {
    this.visible = false;
    this.visibleChange.emit(false);
    this.croppedImage = null;
    this.resetTransform();
  }

  private resetTransform() {
    this.canvasRotation = 0;
    this.transform = {
      flipH: false,
      flipV: false,
      rotate: 0
    };
  }
}
