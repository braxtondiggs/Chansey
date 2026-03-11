import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, inject, Input, OnDestroy, OnInit } from '@angular/core';

@Component({
  selector: 'app-lazy-image',
  standalone: true,
  imports: [CommonModule],
  template: `
    <img
      [src]="isIntersecting ? src : ''"
      [alt]="alt"
      [class]="className"
      [attr.width]="width || null"
      [attr.height]="height || null"
      [ngClass]="{
        'opacity-0': !isLoaded,
        'transition-opacity delay-75 duration-700 ease-out': true
      }"
      (load)="handleLoad()"
      #image
    />
  `
})
export class LazyImageComponent implements OnInit, OnDestroy {
  @Input() src = '';
  @Input() alt = '';
  @Input() className = '';
  @Input() width: number | undefined;
  @Input() height: number | undefined;

  private readonly el = inject(ElementRef);
  private readonly cdr = inject(ChangeDetectorRef);
  isIntersecting = false;
  isLoaded = false;
  imageElement: HTMLElement | undefined;

  ngOnInit() {
    this.imageElement = this.el.nativeElement.querySelector('img');

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          this.isIntersecting = true;
          this.cdr.markForCheck();
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0 }
    );

    if (this.imageElement) {
      observer.observe(this.imageElement);
    }
  }

  ngOnDestroy() {
    if (this.imageElement) {
      this.imageElement = undefined;
    }
  }

  handleLoad() {
    this.isLoaded = true;
  }
}
