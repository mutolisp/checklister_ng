/**
 * 標本採集 —— 預設鑑定者、採集號前綴／起始號／補零位數。
 *
 * Moved out of the 偏好設定 root: it was the longest inline block there, and
 * `nextRecordNumber()` is recomputed on every render so the hint reflects the
 * prefix just typed — that cost belongs on this screen, not on the root page.
 */
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, Text, View } from 'react-native';
import { LinkRow, RowInput } from '~/components/settings/rows';
import { SettingsPage } from '~/components/settings/SettingsPage';
import { promptText } from '~/components/TextPromptModal';
import { formatRecordNumber, maxRecordNumberSeq, nextRecordNumber } from '~/db';
import { useSettings } from '~/stores/settings';
import { useToast } from '~/stores/toast';

export default function CollectionSettingsScreen() {
  const { t } = useTranslation();
  const toast = useToast((s) => s.show);
  const identifiedBy = useSettings((s) => s.default_identified_by);
  const prefix = useSettings((s) => s.collection_number_prefix);
  const pad = useSettings((s) => s.collection_number_pad);
  const setSetting = useSettings((s) => s.set);

  // Recomputed on every render so the hint reflects the prefix/start just typed.
  const nextNumberPreview = nextRecordNumber().text;

  /**
   * 強制指定下一個採集號。
   *
   * 底層仍是 collection_number_start（nextRecordNumber 取
   * max(資料庫最大序號 + 1, start)），所以只能往前跳、不能往回。輸入值若不大於
   * 目前最大序號，設了也不會生效 —— 這種情況要明講，不能靜默吞掉。
   */
  const handleSetNextNumber = async () => {
    const maxSeq = maxRecordNumberSeq();
    const current = nextRecordNumber();
    const input = await promptText({
      title: t('settings.setNextNumberTitle'),
      message:
        maxSeq > 0
          ? t('settings.setNextNumberMsg', { max: formatRecordNumber(maxSeq), next: current.text })
          : t('settings.setNextNumberMsgEmpty', { next: current.text }),
      keyboardType: 'numeric',
      defaultValue: String(current.seq),
    });
    if (input == null) return;

    const seq = Math.floor(Number(input.trim()));
    if (!Number.isFinite(seq) || seq < 1) {
      toast(t('settings.setNextNumberInvalid'));
      return;
    }
    if (seq <= maxSeq) {
      // 採集號只會往前：資料庫已經有更大的號了，設下去不會生效。
      Alert.alert(
        t('settings.setNextNumberTooLowTitle'),
        t('settings.setNextNumberTooLowMsg', {
          value: formatRecordNumber(seq),
          max: formatRecordNumber(maxSeq),
          next: formatRecordNumber(maxSeq + 1),
        }),
        [{ text: t('common.ok') }],
      );
      return;
    }

    Alert.alert(
      t('settings.setNextNumberConfirmTitle'),
      t('settings.setNextNumberConfirmMsg', { value: formatRecordNumber(seq) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: () => {
            setSetting('collection_number_start', seq);
            toast(t('settings.setNextNumberDone', { value: formatRecordNumber(seq) }));
          },
        },
      ],
    );
  };

  return (
    <SettingsPage>
      <ScrollView>
        <View className="mt-6">
          {/* 預設鑑定者：新增標本時自動帶入，比照採集者從行程繼承的作法。
              留空表示不帶入——標籤上寧可沒有這一行，也不要掛一個沒定過名的人。 */}
          <RowInput
            label={t('settings.defaultDeterminer')}
            value={identifiedBy}
            placeholder={t('settings.defaultDeterminerPlaceholder')}
            onCommit={(v) => setSetting('default_identified_by', v.trim())}
          />
          <RowInput
            label={t('collection.numberPrefix')}
            value={prefix}
            placeholder={t('settings.numberPrefixPlaceholder')}
            autoCapitalize="characters"
            onCommit={(v) => setSetting('collection_number_prefix', v.trim())}
          />
          {/* 取代原本會在失焦時靜默寫入的「起始號」輸入框：改號會影響實體標本
              編號，必須先讓使用者看到目前狀態並確認。底層設定同一個。 */}
          <LinkRow
            label={t('collection.numberStart')}
            value={nextNumberPreview}
            onPress={handleSetNextNumber}
          />
          <RowInput
            label={t('collection.numberPad')}
            value={String(pad)}
            placeholder="4"
            keyboardType="number-pad"
            onCommit={(v) => {
              // 0 = 不補零；上限 10 避免打錯字產生荒謬的長號碼。
              const n = Math.floor(Number(v));
              const clamped = Number.isFinite(n) ? Math.min(Math.max(n, 0), 10) : 4;
              setSetting('collection_number_pad', clamped);
            }}
          />
          <View className="bg-white dark:bg-gray-900 px-4 pb-3">
            <Text className="text-xs text-gray-500 dark:text-gray-400">
              {t('settings.collectionNumberDesc', { next: nextNumberPreview })}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SettingsPage>
  );
}
