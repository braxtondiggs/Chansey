import { CommonModule } from '@angular/common';
import { Component, ElementRef, inject, Input, OnDestroy, OnInit } from '@angular/core';

@Component({
  selector: 'app-lazy-image',
  standalone: true,
  imports: [CommonModule],
  template: `
    <img
      [src]="isIntersecting ? src : ''"
      [alt]="alt"
      [class]="className"
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

  private readonly el = inject(ElementRef);
  isIntersecting = false;
  isLoaded = false;
  imageElement: HTMLElement | undefined;

  ngOnInit() {
    this.imageElement = this.el.nativeElement.querySelector('img');

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.1) {
          this.isIntersecting = true;
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1 }
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
