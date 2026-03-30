# Calculators

## Overview

Indicator calculator implementations that wrap the `technicalindicators` npm package. Each calculator extends `BaseIndicatorCalculator` to provide a consistent interface for computing technical analysis indicators from raw price data. Calculators are stateless and instantiated once in the `IndicatorService` calculator map.

## Calculators

| ID               | Class                        | Options Type                      | Result Type                |
| ---------------- | ---------------------------- | --------------------------------- | -------------------------- |
| `sma`            | `SMACalculator`              | `CalculatorPeriodOptions`         | `number[]`                 |
| `ema`            | `EMACalculator`              | `CalculatorPeriodOptions`         | `number[]`                 |
| `rsi`            | `RSICalculator`              | `CalculatorPeriodOptions`         | `number[]`                 |
| `sd`             | `StandardDeviationCalculator`| `CalculatorPeriodOptions`         | `number[]`                 |
| `macd`           | `MACDCalculator`             | `CalculatorMACDOptions`           | `MACDDataPoint[]`          |
| `bollingerBands` | `BollingerBandsCalculator`   | `CalculatorBollingerBandsOptions` | `BollingerBandsDataPoint[]`|
| `atr`            | `ATRCalculator`              | `CalculatorATROptions`            | `number[]`                 |

## Contract

`BaseIndicatorCalculator<TOptions, TResult>` implements `IIndicatorCalculator` and requires three abstract methods:

- **`calculate(options: TOptions): TResult`** -- compute indicator values from input data
- **`getWarmupPeriod(options: Partial<TOptions>): number`** -- minimum data points before valid output
- **`validateOptions(options: TOptions): void`** -- throw if options are malformed

Inherited helper methods:

- `padResults(results, originalLength)` -- left-pad with `NaN` to align output with input array length
- `countValidValues(values)` -- count non-`NaN` entries
- `validatePeriod(period, name)` -- assert positive integer
- `validateDataLength(values, minLength)` -- assert sufficient input data
- `validateNumericValues(values)` -- assert all entries are valid numbers

## How to Add a New Calculator

1. Create a class in this directory extending `BaseIndicatorCalculator<TOptions, TResult>`. Set `id` and `name` readonly properties and implement `calculate()`, `getWarmupPeriod()`, and `validateOptions()`. Define option/result types in `indicator.interface.ts` and add the entry to `IndicatorCalculatorMap`.
2. Export the class from `index.ts`.
3. Register an instance in the `calculators` map inside `IndicatorService` and add a corresponding public method to expose it.

## Gotchas

- **Warmup period does not equal minimum data length.** RSI with `period=14` needs 15 input values (14 price changes). ATR similarly needs `period + 1` values because the first True Range requires a previous close.
- **All results are padded to input length with leading `NaN`.** The `IndicatorService` calls `padResults()` so output arrays align index-for-index with the input price array.
- **All calculators wrap the `technicalindicators` npm package.** They do not implement indicator math directly. If the upstream library changes behavior, calculator output changes too.
- **ATR requires three parallel arrays** (`high`, `low`, `close`) of equal length, unlike the other calculators which take a single `values` array.
