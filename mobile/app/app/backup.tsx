import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showActionSheet } from '~/components/ActionSheet';
import {
  createBackup,
  createPhotoBackup,
  deleteSafetyBackup,
  restoreBackup,
  restoreSafetyBackup,
} from '~/lib/backup';
import { listSafetyBackups } from '~/db';
import type { ExportFile } from '~/lib/bundleExport';

type Busy = null | 'backup' | 'photos' | 'restore';

export default function BackupScreen() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState('');

  // 自動安全備份：cleanup.ts 在執行會改寫既有列的修復前留下的快照。
  // 它們寫在 app 私有目錄，DocumentPicker 看不到，所以必須由這一頁提供入口，
  // 否則備份存在卻無法還原，等於只做一半。
  const [safety, setSafety] = useState<{ name: string; uri: string; size: number }[]>([]);
  const refreshSafety = useCallback(() => setSafety(listSafetyBackups()), []);
  useEffect(refreshSafety, [refreshSafety]);

  const handleRestoreSafety = (name: string) => {
    Alert.alert(t('backup.safetyRestoreConfirmTitle'), t('backup.safetyRestoreConfirmMsg', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('backup.restore'),
        style: 'destructive',
        onPress: async () => {
          try {
            setBusy('restore');
            await restoreSafetyBackup(name);
          } catch (e) {
            setBusy(null);
            Alert.alert(t('backup.restoreFailed'), e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  };

  const handleDeleteSafety = (name: string) => {
    Alert.alert(t('backup.safetyDeleteConfirmTitle'), t('backup.safetyDeleteConfirmMsg', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          deleteSafetyBackup(name);
          refreshSafety();
        },
      },
    ]);
  };

  const share = async (file: ExportFile) => {
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert(t('backup.shareUnavailable'), t('backup.fileGenerated', { uri: file.uri }));
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
      Alert.alert(t('backup.backupFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handlePhotoBackup = async () => {
    if (busy) return;
    try {
      setBusy('photos');
      setProgress('');
      const file = await createPhotoBackup((done, total) => setProgress(t('backup.photoProgress', { done, total })));
      if (!file) {
        Alert.alert(t('backup.noPhotos'), t('backup.noPhotosMsg'));
        return;
      }
      await share(file);
    } catch (e) {
      Alert.alert(t('backup.photoBackupFailed'), e instanceof Error ? e.message : String(e));
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
        title: t('backup.restoreTitle'),
        message: t('backup.restoreMsg'),
        options: [{ label: t('backup.restoreConfirm'), destructive: true }],
      });
      if (confirm !== 0) return;

      setBusy('restore');
      // On success this reloads the app, so control won't return here.
      await restoreBackup(uri);
    } catch (e) {
      setBusy(null);
      Alert.alert(t('backup.restoreFailed'), e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <ScrollView className="flex-1">
        <Section
          icon="archive-outline"
          title={t('backup.dataBackupTitle')}
          desc={t('backup.dataBackupDesc')}
        >
          <ActionButton
            label={t('backup.createExport')}
            onPress={handleBackup}
            busy={busy === 'backup'}
            disabled={busy !== null}
          />
        </Section>

        <Section
          icon="images-outline"
          title={t('backup.photoBackupTitle')}
          desc={t('backup.photoBackupDesc')}
        >
          <ActionButton
            label={t('backup.exportPhotos')}
            onPress={handlePhotoBackup}
            busy={busy === 'photos'}
            disabled={busy !== null}
          />
          {busy === 'photos' && progress ? (
            <Text className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t('backup.processing', { progress })}</Text>
          ) : null}
        </Section>

        <Section
          icon="cloud-upload-outline"
          title={t('backup.dataRestoreTitle')}
          desc={t('backup.dataRestoreDesc')}
        >
          <ActionButton
            label={t('backup.restoreFromFile')}
            onPress={handleRestore}
            busy={busy === 'restore'}
            disabled={busy !== null}
            destructive
          />
        </Section>

        {safety.length > 0 ? (
          <Section
            icon="shield-checkmark-outline"
            title={t('backup.safetyTitle')}
            desc={t('backup.safetyDesc')}
          >
            {safety.map((f) => (
              <View
                key={f.name}
                className="mt-2 flex-row items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2"
              >
                <View className="flex-1 pr-2">
                  <Text className="text-sm text-gray-900 dark:text-gray-100" numberOfLines={1}>
                    {f.name.replace(/^safety-backup-|\.db$/g, '')}
                  </Text>
                  <Text className="text-xs text-gray-500 dark:text-gray-400">
                    {(f.size / 1024).toFixed(0)} KB
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleRestoreSafety(f.name)}
                  disabled={busy !== null}
                  hitSlop={8}
                  className="mr-3 active:opacity-60"
                >
                  <Text className="text-sm font-medium text-blue-600 dark:text-blue-400">
                    {t('backup.restore')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => handleDeleteSafety(f.name)}
                  disabled={busy !== null}
                  hitSlop={8}
                  className="active:opacity-60"
                >
                  <Ionicons name="trash-outline" size={18} color="#dc2626" />
                </Pressable>
              </View>
            ))}
          </Section>
        ) : null}
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
