/**
 * Cross-platform date+time field.
 *
 * Why a component and not an imperative `pickDateTime()` like `promptText` /
 * `showActionSheet`: on iOS the picker has to be a *view*, because its only
 * other form is an RN `<Modal>` — and iOS UIKit refuses to present a second
 * Modal while one is already on screen (see the comment in
 * `ProjectAssignSheet.handleCreateInline`). This field is used from inside
 * `SpecimenDetailSheet`, which is itself a Modal, so a modal picker would
 * silently never appear there.
 *
 * The platform split is the picker's own asymmetry, not ours: its types declare
 * `IOSMode = 'date' | 'time' | 'datetime' | 'countdown'` but
 * `AndroidMode = 'date' | 'time'`, so Android physically cannot do both in one
 * dialog and has to chain two. That difference lives here and nowhere else
 * (same containment rule as `ActionSheet.tsx`).
 *
 *  - iOS: tapping expands a spinner inline; edits stage locally and commit on 完成.
 *  - Android: tapping opens the platform's own dialog(s). Backing out cancels.
 *
 * `mode` picks which half is edited. 'date' / 'time' edit only that part and
 * carry the other part of `value` through unchanged, so a caller can show two
 * separate fields over a single timestamp without a schema change. Only
 * 'datetime' needs Android's two-dialog chain.
 */
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text, View } from 'react-native';
import { isoDate, isoDateTime, isoTime } from '~/lib/datetime';

type Mode = 'date' | 'time' | 'datetime';

type Props = {
  /** Current value, epoch ms. */
  value: number;
  /** Called once with the chosen value. Not called on cancel. */
  onChange: (ts: number) => void;
  /** Which half to edit. Defaults to the whole timestamp. */
  mode?: Mode;
};

/** Merge only the half this field owns back into the existing timestamp, so
 *  editing the date keeps the time of day and vice versa. */
function mergePart(base: number, picked: Date, mode: Mode): number {
  const out = new Date(base);
  if (mode === 'time') out.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  else out.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  return out.getTime();
}

/** Android: one dialog for 'date'/'time'; for 'datetime' the date dialog chains
 *  into the time dialog. `event.type` is 'dismissed' when the user backs out,
 *  which cancels the whole edit rather than silently keeping half of it. */
function openAndroid(value: number, mode: Mode, onChange: (ts: number) => void): void {
  if (mode !== 'datetime') {
    DateTimePickerAndroid.open({
      value: new Date(value),
      mode,
      is24Hour: true,
      onChange: (e: DateTimePickerEvent, picked?: Date) => {
        if (e.type === 'dismissed' || !picked) return;
        onChange(mergePart(value, picked, mode));
      },
    });
    return;
  }
  DateTimePickerAndroid.open({
    value: new Date(value),
    mode: 'date',
    onChange: (dateEvent: DateTimePickerEvent, picked?: Date) => {
      if (dateEvent.type === 'dismissed' || !picked) return;
      const datePart = picked;
      DateTimePickerAndroid.open({
        value: datePart,
        mode: 'time',
        is24Hour: true,
        onChange: (timeEvent: DateTimePickerEvent, time?: Date) => {
          if (timeEvent.type === 'dismissed' || !time) return;
          const out = new Date(datePart);
          out.setHours(time.getHours(), time.getMinutes(), 0, 0);
          onChange(out.getTime());
        },
      });
    },
  });
}

export function DateTimeField({ value, onChange, mode = 'datetime' }: Props) {
  const { t } = useTranslation();
  // iOS only: the inline spinner reports every intermediate wheel position, so
  // edits stage here and hit the DB once, on 完成.
  const [draft, setDraft] = useState<number | null>(null);
  const expanded = draft !== null;

  const handlePress = () => {
    if (Platform.OS === 'ios') setDraft(expanded ? null : value);
    else openAndroid(value, mode, onChange);
  };

  return (
    <View>
      <Pressable
        onPress={handlePress}
        className="flex-row items-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 active:opacity-70"
      >
        <Ionicons name={mode === 'date' ? 'calendar-outline' : 'time-outline'} size={16} color="#2563eb" />
        <Text className="ml-2 flex-1 text-base text-gray-900 dark:text-gray-100">
          {mode === 'date'
            ? isoDate(draft ?? value)
            : mode === 'time'
              ? isoTime(draft ?? value)
              : isoDateTime(draft ?? value)}
        </Text>
        <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={16} color="#9ca3af" />
      </Pressable>

      {expanded ? (
        <View className="mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <DateTimePicker
            value={new Date(draft)}
            mode={mode}
            display="spinner"
            is24Hour
            onChange={(_e: DateTimePickerEvent, d?: Date) => {
              // 只把自己負責的那半併回去，另一半沿用原值。
              if (d) setDraft(mode === 'datetime' ? d.getTime() : mergePart(draft, d, mode));
            }}
          />
          <View className="flex-row justify-end gap-4 border-t border-gray-200 dark:border-gray-700 px-3 py-2">
            <Pressable onPress={() => setDraft(null)} hitSlop={8} className="active:opacity-60">
              <Text className="text-sm text-gray-500 dark:text-gray-400">{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const out = draft;
                setDraft(null);
                onChange(out);
              }}
              hitSlop={8}
              className="active:opacity-60"
            >
              <Text className="text-sm font-medium text-blue-600 dark:text-blue-400">
                {t('common.done')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
