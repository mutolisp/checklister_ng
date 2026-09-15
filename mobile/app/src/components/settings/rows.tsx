/**
 * The row vocabulary shared by 偏好設定 and its detail pages.
 *
 * `Section` and `RowInput` moved here verbatim from app/settings.tsx; keeping
 * them private to that file is why the 標本採集 block ended up inlined there in
 * the first place.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';

const ROW = 'bg-white dark:bg-gray-900 px-4 py-3';
const DIVIDER = 'border-b border-gray-100 dark:border-gray-800';
const PRESSED = 'active:bg-gray-50 dark:active:bg-gray-800';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-6">
      <Text className="px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</Text>
      {children}
    </View>
  );
}

/** Uncontrolled text row committed on blur — same interaction as the plot
 *  env-tab fields, so a half-typed value never lands in settings. */
export function RowInput({
  label,
  value,
  placeholder,
  keyboardType,
  autoCapitalize,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad';
  autoCapitalize?: 'none' | 'characters';
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <View className={`flex-row items-center justify-between ${DIVIDER} ${ROW}`}>
      <Text className="text-base text-gray-900 dark:text-gray-100">{label}</Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={() => onCommit(draft)}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
        className="min-w-[120px] rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-right text-base text-gray-900 dark:text-gray-100"
      />
    </View>
  );
}

/** A tappable row. `value` is the current setting shown inline (採集號),
 *  `description` the subtitle. Set `chevron={false}` for a row that acts in
 *  place (資料檢查, 清除…) rather than navigating — the glyph is what tells the
 *  user which of the two this is. */
export function LinkRow({
  label,
  description,
  value,
  destructive = false,
  chevron = true,
  onPress,
}: {
  label: string;
  description?: string;
  value?: string;
  destructive?: boolean;
  chevron?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`flex-row items-center justify-between ${DIVIDER} ${ROW} ${PRESSED}`}
    >
      <View className="flex-1 pr-3">
        <Text className={`text-base ${destructive ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
          {label}
        </Text>
        {description ? (
          <Text className="text-xs text-gray-500 dark:text-gray-400">{description}</Text>
        ) : null}
      </View>
      <View className="flex-row items-center">
        {value ? (
          <Text className="mr-1 text-base text-gray-500 dark:text-gray-400">{value}</Text>
        ) : null}
        {chevron ? <Ionicons name="chevron-forward" size={value ? 16 : 18} color="#9ca3af" /> : null}
      </View>
    </Pressable>
  );
}

/**
 * A settings row whose value is picked from a short list.
 *
 * `variant='row'` is the full-bleed settings row; `variant='inline'` puts the
 * label above a full-width trigger, for the card layouts (iNaturalist, the
 * upload screen) where a bordered box next to a TextInput reads better.
 *
 * The option values stay `T` at the call site — `settings.set('undo_duration')`
 * wants a number — and are converted at the primitive boundary, which only
 * speaks strings.
 */
export function SelectRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
  variant = 'row',
  disabled = false,
  divider = true,
  description,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  variant?: 'row' | 'inline';
  disabled?: boolean;
  divider?: boolean;
  description?: string;
}) {
  const current = options.find((o) => o.value === value);
  const selected = current ? { value: String(current.value), label: current.label } : undefined;

  const handleChange = (opt: { value: string; label: string } | undefined) => {
    if (!opt) return;
    const match = options.find((o) => String(o.value) === opt.value);
    if (match) onChange(match.value);
  };

  const select = (
    <Select value={selected} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger
        className={variant === 'inline' ? 'w-full' : 'min-w-[140px]'}
        accessibilityLabel={label}
      >
        <SelectValue placeholder={String(value)} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={String(o.value)} value={String(o.value)} label={o.label} />
        ))}
      </SelectContent>
    </Select>
  );

  if (variant === 'inline') {
    return (
      <View>
        <Text className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">{label}</Text>
        {select}
        {description ? (
          <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View className={`flex-row items-center justify-between ${divider ? DIVIDER : ''} ${ROW}`}>
      <View className="flex-1 pr-3">
        <Text className="text-base text-gray-900 dark:text-gray-100">{label}</Text>
        {description ? (
          <Text className="text-xs text-gray-500 dark:text-gray-400">{description}</Text>
        ) : null}
      </View>
      {select}
    </View>
  );
}
