import { type SurfacesType } from './surface-palettes';

export function getPresetExtension(
  primaryColors: SurfacesType[],
  selectedPrimaryColor: string
): Record<string, unknown> {
  const color: SurfacesType = primaryColors.find((c) => c.name === selectedPrimaryColor) || {};

  if (color.name === 'noir') {
    return {
      semantic: {
        primary: {
          50: '{surface.50}',
          100: '{surface.100}',
          200: '{surface.200}',
          300: '{surface.300}',
          400: '{surface.400}',
          500: '{surface.500}',
          600: '{surface.600}',
          700: '{surface.700}',
          800: '{surface.800}',
          900: '{surface.900}',
          950: '{surface.950}'
        },
        colorScheme: {
          light: {
            primary: {
              color: '{primary.950}',
              contrastColor: '#ffffff',
              hoverColor: '{primary.800}',
              activeColor: '{primary.700}'
            },
            highlight: {
              background: '{primary.950}',
              focusBackground: '{primary.700}',
              color: '#ffffff',
              focusColor: '#ffffff'
            }
          },
          dark: {
            primary: {
              color: '{primary.50}',
              contrastColor: '{primary.950}',
              hoverColor: '{primary.200}',
              activeColor: '{primary.300}'
            },
            highlight: {
              background: '{primary.50}',
              focusBackground: '{primary.300}',
              color: '{primary.950}',
              focusColor: '{primary.950}'
            }
          }
        }
      }
    };
  } else {
    return {
      semantic: {
        primary: color.palette,
        colorScheme: {
          light: {
            primary: {
              color: '{primary.500}',
              contrastColor: '#ffffff',
              hoverColor: '{primary.600}',
              activeColor: '{primary.700}'
            },
            highlight: {
              background: '{primary.50}',
              focusBackground: '{primary.100}',
              color: '{primary.700}',
              focusColor: '{primary.800}'
            }
          },
          dark: {
            primary: {
              color: '{primary.400}',
              contrastColor: '{surface.900}',
              hoverColor: '{primary.300}',
              activeColor: '{primary.200}'
            },
            highlight: {
              background: 'color-mix(in srgb, {primary.400}, transparent 84%)',
              focusBackground: 'color-mix(in srgb, {primary.400}, transparent 76%)',
              color: 'rgba(255,255,255,.87)',
              focusColor: 'rgba(255,255,255,.87)'
            }
          }
        }
      }
    };
  }
}
