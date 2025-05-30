import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'formatLargeNumber',
  standalone: true
})
export class FormatLargeNumberPipe implements PipeTransform {
  transform(value: number | string | undefined | null, currency: string = '$', decimals: number = 2): string {
    if (value === undefined || value === null || value === '' || isNaN(Number(value))) {
      return 'N/A';
    }

    const numValue = Number(value);
    
    if (numValue === 0) {
      return `${currency}0`;
    }

    const absValue = Math.abs(numValue);
    
    if (absValue >= 1e12) {
      // Trillions
      return `${currency}${(numValue / 1e12).toFixed(decimals)}T`;
    } else if (absValue >= 1e9) {
      // Billions
      return `${currency}${(numValue / 1e9).toFixed(decimals)}B`;
    } else if (absValue >= 1e6) {
      // Millions
      return `${currency}${(numValue / 1e6).toFixed(decimals)}M`;
    } else if (absValue >= 1e3) {
      // Thousands
      return `${currency}${(numValue / 1e3).toFixed(decimals)}K`;
    } else {
      // Less than 1000, show as regular amount
      return `${currency}${numValue.toFixed(decimals)}`;
    }
  }
}
