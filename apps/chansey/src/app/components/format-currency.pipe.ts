import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'formatCurrency',
  standalone: true
})
export class FormatCurrencyPipe implements PipeTransform {
  transform(value: number | undefined): string {
    if (value === undefined || value === null) {
      return 'N/A';
    }

    // Format based on the value's magnitude
    if (value >= 1_000_000_000) {
      return `$${(value / 1_000_000_000).toFixed(2)}B`;
    } else if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(2)}M`;
    } else if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(2)}K`;
    } else if (value < 0.01) {
      return `$${value.toFixed(6)}`;
    } else {
      return `$${value.toFixed(2)}`;
    }
  }
}
