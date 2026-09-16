/**
 * 導覽列圖示按鈕 —— the one shape every header action uses.
 *
 * Replaces the bare glyph that used to be copy-pasted into each screen
 * (`h-9 w-9 items-center justify-center active:opacity-60` + a hard-coded
 * `#2563eb`). A floating icon gives no hint that it is pressable and no hint
 * where its edge is, which matters more than usual here: this is a field app,
 * used one-handed, often with wet or gloved fingers.
 *
 * The disc is what changes on press — fading the whole button out (the old
 * `active:opacity-60`) makes the target look like it is disappearing rather
 * than being pushed.
 *
 * The 36pt disc plus `hitSlop` clears the 44pt minimum touch target on both
 * platforms even though the disc itself reads as smaller.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';

/** App accent for header actions. Matches the 匯出 teal so the header and the
 *  swipe actions read as one palette rather than two. */
const TINT = '#00A2A5';
const TINT_DANGER = '#dc2626';
const TINT_DISABLED = '#9ca3af';

export function HeaderIconButton({
  icon,
  onPress,
  label,
  disabled = false,
  tone = 'default',
  edge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** Screen-reader name. The glyph carries no text, so this is the only label. */
  label: string;
  disabled?: boolean;
  /** 結束記錄 and friends keep a red glyph on the same neutral disc — a red
   *  disc would shout louder than the action deserves in a header. */
  tone?: 'default' | 'danger';
  /** `left` pulls the disc back toward the header edge, where the native back
   *  button would sit. Use on `headerLeft`. */
  edge?: 'left';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      className={`h-9 w-9 items-center justify-center rounded-full ${edge === 'left' ? '-ml-1' : ''} ${
        disabled
          ? 'bg-gray-100 dark:bg-gray-800'
          : 'bg-gray-100 active:bg-gray-200 dark:bg-gray-800 dark:active:bg-gray-700'
      }`}
    >
      <Ionicons
        name={icon}
        size={22}
        color={disabled ? TINT_DISABLED : tone === 'danger' ? TINT_DANGER : TINT}
      />
    </Pressable>
  );
}
