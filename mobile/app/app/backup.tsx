import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showActionSheet } from '~/components/ActionSheet';
import { createBackup, createPhotoBackup, restoreBackup } from '~/lib/backup';
import type { ExportFile } from '~/lib/bundleExport';

type Busy = null | 'backup' | 'photos' | 'restore';

export default function BackupScreen() {
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState('');

  const share = async (file: ExportFile) => {
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('系統分享不可用', `已產出檔案：${file.uri}`);
      return;
    }
    await Sharing.shareAsync(file.uri, { mimeType: file.mimeType, dialogTitle: file.filename });
  };

  const handleBackup = async () => {
    if (busy) return;
    try {
      setBusy('backup');
      const file = await createBackup();
      await share(file);
    } catch (e) {
      Alert.alert('備份失敗', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handlePhotoBackup = async () => {
    if (busy) return;
    try {
      setBusy('photos');
      setProgress('');
      const file = await createPhotoBackup((done, total) => setProgress(`${done}/${total} 張`));
      if (!file) {
        Alert.alert('沒有照片', '目前的記錄沒有任何照片可備份。');
        return;
      }
      await share(file);
    } catch (e) {
      Alert.alert('照片備份失敗', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress('');
    }
  };

  const handleRestore = async () => {
    if (busy) return;
    try {
      const r = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/x-zip-compressed', '*/*'],
        copyToCacheDirectory: true,
      });
      if (r.canceled) return;
      const uri = r.assets[0]?.uri;
      if (!uri) return;

      const confirm = await showActionSheet({
        title: '回復備份',
        message: '這會覆蓋目前 app 內的所有資料（名錄、樣區、常用名錄、設定），且無法復原。完成後 app 會自動重啟。',
        options: [{ label: '回復並覆蓋', destructive: true }],
      });
      if (confirm !== 0) return;

      setBusy('restore');
      // On success this reloads the app, so control won't return here.
      await restoreBackup(uri);
    } catch (e) {
      setBusy(null);
      Alert.alert('回復失敗', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <ScrollView className="flex-1">
        <Section
          icon="archive-outline"
          title="資料備份"
          desc="把所有使用者資料（名錄、樣區、常用名錄、偏好設定）打包成 zip 檔，可另存或傳到其他地方。不含照片。"
        >
          <ActionButton
            label="建立備份並匯出"
            onPress={handleBackup}
            busy={busy === 'backup'}
            disabled={busy !== null}
          />
        </Section>

        <Section
          icon="images-outline"
          title="照片備份"
          desc="把所有記錄引用到的照片匯出成 zip，內含對應表（photos.csv）。僅供存檔/轉移，回復資料時不會自動還原照片。"
        >
          <ActionButton
            label="匯出照片"
            onPress={handlePhotoBackup}
            busy={busy === 'photos'}
            disabled={busy !== null}
          />
          {busy === 'photos' && progress ? (
            <Text className="mt-2 text-xs text-gray-500 dark:text-gray-400">處理中… {progress}</Text>
          ) : null}
        </Section>

        <Section
          icon="cloud-upload-outline"
          title="資料回復"
          desc="從備份 zip 回復使用者資料。⚠️ 會覆蓋目前所有資料，無法復原，完成後 app 會自動重啟。"
        >
          <ActionButton
            label="從備份檔回復"
            onPress={handleRestore}
            busy={busy === 'restore'}
            disabled={busy !== null}
            destructive
          />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  icon,
  title,
  desc,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mt-3 bg-white dark:bg-gray-900 px-4 py-4 border-y border-gray-200 dark:border-gray-700">
      <View className="flex-row items-center">
        <Ionicons name={icon} size={20} color="#4b5563" />
        <Text className="ml-2 text-base font-semibold text-gray-900 dark:text-gray-100">{title}</Text>
      </View>
      <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">{desc}</Text>
      <View className="mt-3">{children}</View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  busy,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  disabled: boolean;
  destructive?: boolean;
}) {
  const base = destructive ? 'bg-red-500 active:bg-red-600' : 'bg-blue-500 active:bg-blue-600';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-row items-center justify-center rounded-lg px-4 py-3 ${base} ${disabled && !busy ? 'opacity-40' : ''}`}
    >
      {busy ? <ActivityIndicator size="small" color="white" /> : null}
      <Text className={`text-sm font-medium text-white ${busy ? 'ml-2' : ''}`}>{label}</Text>
    </Pressable>
  );
}
