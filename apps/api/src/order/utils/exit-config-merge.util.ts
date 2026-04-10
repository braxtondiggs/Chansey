import { DEFAULT_EXIT_CONFIG, type ExitConfig } from '../interfaces/exit-config.interface';

/**
 * Merge multiple partial ExitConfig layers into a single resolved ExitConfig.
 *
 * Layers are applied in order (lowest-to-highest priority). Undefined values
 * in higher-priority layers do not override lower layers.
 *
 * Typical call pattern:
 *   resolveExitConfig(userConfig, resultExitConfig, signalExitConfig)
 *
 * The system default (DEFAULT_EXIT_CONFIG) is always the base layer.
 */
export function resolveExitConfig(...layers: Array<Partial<ExitConfig> | undefined>): ExitConfig {
  const result = { ...DEFAULT_EXIT_CONFIG };

  for (const layer of layers) {
    if (!layer) continue;
    const defined = Object.fromEntries(Object.entries(layer).filter(([, v]) => v !== undefined));
    Object.assign(result, defined);
  }

  return result;
}
