import { Module } from '@nestjs/common';

import { IndicatorService } from './indicator.service';

import { SharedCacheModule } from '../../shared-cache.module';

/**
 * Indicator Module
 *
 * Provides the IndicatorService for calculating technical indicators
 * with caching support.
 *
 * @example
 * // Import in your module
 * imports: [IndicatorModule]
 *
 * // Inject in your service
 * constructor(private readonly indicatorService: IndicatorService) {}
 */
@Module({
  imports: [SharedCacheModule],
  providers: [IndicatorService],
  exports: [IndicatorService]
})
export class IndicatorModule {}
