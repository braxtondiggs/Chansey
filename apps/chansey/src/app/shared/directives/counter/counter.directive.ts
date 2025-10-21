import { Directive, ElementRef, Input, NgZone, OnChanges, OnInit, SimpleChanges, inject } from '@angular/core';

@Directive({
  selector: '[appCounter]',
  standalone: true
})
export class CounterDirective implements OnInit, OnChanges {
  @Input() appCounter: number | undefined = 0;
  @Input() duration = 1000; // animation duration in milliseconds
  @Input() formatter: (value: number) => string = (value) => {
    // Round the value to avoid floating point precision issues during animation
    const roundedValue = Math.round(value * 100) / 100;

    // For values >= 1, show 2 decimal places
    // For values < 1, show up to 6 decimal places but remove trailing zeros
    if (roundedValue >= 1) {
      return `$${roundedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else if (roundedValue > 0) {
      // For small values, show more precision but clean up trailing zeros
      const formatted = roundedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
      return `$${formatted.replace(/\.?0+$/, '')}`;
    } else {
      return '$0.00';
    }
  };

  private previousValue: number = 0;
  private animationFrameId: number | null = null;

  private readonly el = inject(ElementRef);
  private readonly zone = inject(NgZone);

  ngOnInit(): void {
    // Add the rolling-number class for 3D perspective effect
    this.el.nativeElement.classList.add('rolling-number');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['appCounter'] && !changes['appCounter'].firstChange) {
      const newValue = changes['appCounter'].currentValue;
      const oldValue = changes['appCounter'].previousValue;

      if (newValue !== oldValue && typeof newValue === 'number') {
        // Store the previous value for color flash logic
        this.previousValue = oldValue;

        // Execute the animation outside Angular's change detection
        this.zone.runOutsideAngular(() => {
          this.animateCount(oldValue || 0, newValue);
        });

        // Apply flash effect based on value change
        this.applyFlashEffect(newValue, oldValue);
      }
    } else if (changes['appCounter'] && changes['appCounter'].firstChange) {
      const value = changes['appCounter'].currentValue;
      if (typeof value === 'number') {
        this.previousValue = value;
        this.el.nativeElement.innerHTML = this.formatter(value);
      }
    }
  }

  private animateCount(from: number, to: number): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const startTime = performance.now();
    const updateCount = (currentTime: number) => {
      const elapsedTime = currentTime - startTime;
      const progress = Math.min(elapsedTime / this.duration, 1);

      // Use easeOutExpo for smoother animation
      const easeOutExpo = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const currentValue = from + easeOutExpo * (to - from);

      this.el.nativeElement.innerHTML = this.formatter(currentValue);

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

    // Set the flash color class
    element.classList.add(flashClass);

    // Remove the class after animation completes
    setTimeout(() => {
      this.zone.run(() => {
        element.classList.remove(flashClass);
      });
    }, 1000); // Match this to your CSS animation duration
  }
}
