import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'formatPercent',
  standalone: true
})
export class FormatPercentPipe implements PipeTransform {
  transform(value: number | undefined): string {
    if (value === undefined || value === null) {
      return 'N/A';
    }

    // Format percentage with two decimal places
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  }
}
