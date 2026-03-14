import { Directive, ElementRef, NgZone, OnDestroy, effect, inject, input, untracked } from '@angular/core';

const defaultFormatter = (value: number): string => {
  const roundedValue = Math.round(value * 1e8) / 1e8;

  if (roundedValue >= 1) {
    return `$${roundedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } else if (roundedValue >= 0.01) {
    return `$${roundedValue.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
  } else if (roundedValue > 0) {
    const formatted = roundedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    return `$${formatted}`;
  } else {
    return '$0.00';
  }
};

@Directive({
  selector: '[appCounter]'
})
export class CounterDirective implements OnDestroy {
  readonly appCounter = input<number | undefined>(0);
  readonly duration = input(1000);
  readonly formatter = input<(value: number) => string>(defaultFormatter);

  private previousValue = 0;
  private animationFrameId: number | null = null;
  private flashTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isFirstValue = true;

  private readonly el = inject(ElementRef);
  private readonly zone = inject(NgZone);

  constructor() {
    this.el.nativeElement.classList.add('rolling-number');

    effect(() => {
      const newValue = this.appCounter() ?? 0;
      const fmt = this.formatter();

      if (this.isFirstValue) {
        this.isFirstValue = false;
        this.previousValue = newValue;
        untracked(() => {
          this.el.nativeElement.innerHTML = fmt(newValue);
        });
      } else {
        const oldValue = this.previousValue;
        this.previousValue = newValue;

        if (newValue !== oldValue && typeof newValue === 'number') {
          untracked(() => {
            this.zone.runOutsideAngular(() => {
              this.animateCount(oldValue, newValue, fmt);
            });
            this.applyFlashEffect(newValue, oldValue);
          });
        }
      }
    });
  }

  ngOnDestroy(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.flashTimeoutId !== null) {
      clearTimeout(this.flashTimeoutId);
      this.flashTimeoutId = null;
    }
  }

  private animateCount(from: number, to: number, fmt: (value: number) => string): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const duration = this.duration();
    const startTime = performance.now();
    const updateCount = (currentTime: number) => {
      const elapsedTime = currentTime - startTime;
      const progress = Math.min(elapsedTime / duration, 1);

      const easeOutExpo = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const currentValue = from + easeOutExpo * (to - from);

      this.el.nativeElement.innerHTML = fmt(currentValue);

      if (progress < 1) {
        this.animationFrameId = requestAnimationFrame(updateCount);
      } else {
        this.animationFrameId = null;
      }
    };

    this.animationFrameId = requestAnimationFrame(updateCount);
  }

  private applyFlashEffect(newValue: number, oldValue: number): void {
    if (newValue === oldValue) return;

    const element = this.el.nativeElement;
    const flashClass = newValue > oldValue ? 'value-increase' : 'value-decrease';

    element.classList.add(flashClass);

    this.zone.runOutsideAngular(() => {
      if (this.flashTimeoutId !== null) {
        clearTimeout(this.flashTimeoutId);
      }
      this.flashTimeoutId = setTimeout(() => {
        element.classList.remove(flashClass);
        this.flashTimeoutId = null;
      }, 1000);
    });
  }
}
