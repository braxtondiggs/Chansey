/**
 * DEPRECATED: Old Algorithm Services
 * 
 * This directory contains the old algorithm implementations that used
 * the DynamicAlgorithmServices pattern. These have been replaced with
 * the new strategy pattern architecture.
 * 
 * NEW IMPLEMENTATIONS ARE LOCATED IN: ../strategies/
 * 
 * Migration status:
 * - exponential-moving-average.service.ts → ../strategies/exponential-moving-average.strategy.ts ✅
 * - moving-average-crossover.service.ts → ../strategies/simple-moving-average-crossover.strategy.ts ✅
 * - mean-reversion.service.ts → Needs migration 🔄
 * 
 * These old services are kept for reference during the transition period
 * but should not be used for new development.
 */

// DEPRECATED EXPORTS - DO NOT USE FOR NEW DEVELOPMENT
export * from './exponential-moving-average.service';
export * from './moving-average-crossover.service';
export * from './mean-reversion.service';
