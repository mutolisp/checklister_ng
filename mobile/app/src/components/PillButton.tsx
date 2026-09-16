/**
 * 藥丸按鈕 —— the app's in-content / toolbar button.
 *
 * Distinct from `HeaderIconButton` (the circular disc) on purpose: that one
 * belongs to the navigation header, this one sits in a screen's own toolbar,
 * where a pill can carry a word and does not have to compete with the title.
 *
 * Neutral by default. The colour used to vary per screen — 新增名錄 and 匯入
 * were blue, 排序 grey, the favourites entry amber — which made every toolbar
 * look like it had one important button and some leftovers. Tinting now means
 * something: it is reserved for `amber`, the 常用名錄 colour.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text } from 'react-native';

const TONE = {
  neutral: {
    box: 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900',
    icon: '#4b5563',
    text: 'text-gray-700 dark:text-gray-300',
  },
  amber: {
    box: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40',
    icon: '#d97706',
    text: 'text-amber-700 dark:text-amber-300',
  },
} as const;

export function PillButton({
  icon,
  label,
  a11yLabel,
  onPress,
  tone = 'neutral',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  /** Visible text. Omit for an icon-only pill — then `a11yLabel` is required. */
  label?: string;
  /** Screen-reader name; defaults to `label`. */
  a11yLabel?: string;
  onPress: () => void;
  tone?: keyof typeof TONE;
}) {
  const t = TONE[tone];
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      className={`flex-row items-center rounded-full border ${label ? 'px-3' : 'px-2.5'} py-1.5 active:opacity-70 ${t.box}`}
    >
      <Ionicons name={icon} size={16} color={t.icon} />
      {label ? <Text className={`ml-1 text-xs font-medium ${t.text}`}>{label}</Text> : null}
    </Pressable>
  );
}
