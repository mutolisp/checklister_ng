import { vars } from 'nativewind';
import { type ReactNode } from 'react';
import { View } from 'react-native';
import { useSettings, FONT_SCALE_VALUE } from '~/stores/settings';

const BASE_TS = { xxs: 10, xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30 };
const BASE_LH = { xxs: 14, xs: 16, sm: 20, base: 24, lg: 28, xl: 28, '2xl': 32, '3xl': 36 };

type Props = { children: ReactNode };

/**
 * Wrap app contents and inject CSS vars for scaled font sizes.
 * Tailwind theme.fontSize references these vars (see tailwind.config.js).
 * Changing settings.font_scale propagates to all Text via Tailwind classes.
 */
export function FontScaleProvider({ children }: Props) {
  const fontScale = useSettings((s) => s.font_scale);
  const scale = FONT_SCALE_VALUE[fontScale];

  const cssVars = vars({
    '--ts-xxs': `${Math.round(BASE_TS.xxs * scale)}px`,
    '--ts-xs': `${Math.round(BASE_TS.xs * scale)}px`,
    '--ts-sm': `${Math.round(BASE_TS.sm * scale)}px`,
    '--ts-base': `${Math.round(BASE_TS.base * scale)}px`,
    '--ts-lg': `${Math.round(BASE_TS.lg * scale)}px`,
    '--ts-xl': `${Math.round(BASE_TS.xl * scale)}px`,
    '--ts-2xl': `${Math.round(BASE_TS['2xl'] * scale)}px`,
    '--ts-3xl': `${Math.round(BASE_TS['3xl'] * scale)}px`,
    '--lh-xxs': `${Math.round(BASE_LH.xxs * scale)}px`,
    '--lh-xs': `${Math.round(BASE_LH.xs * scale)}px`,
    '--lh-sm': `${Math.round(BASE_LH.sm * scale)}px`,
    '--lh-base': `${Math.round(BASE_LH.base * scale)}px`,
    '--lh-lg': `${Math.round(BASE_LH.lg * scale)}px`,
    '--lh-xl': `${Math.round(BASE_LH.xl * scale)}px`,
    '--lh-2xl': `${Math.round(BASE_LH['2xl'] * scale)}px`,
    '--lh-3xl': `${Math.round(BASE_LH['3xl'] * scale)}px`,
  });

  return <View style={[{ flex: 1 }, cssVars]}>{children}</View>;
}
