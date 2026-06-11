import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listSites, type SiteWithProject } from '~/db';

const TYPE_LABEL: Record<string, string> = {
  Point: 'sites.typePoint',
  LineString: 'sites.typeLineString',
  Polygon: 'sites.typePolygon',
  MultiPoint: 'sites.typeMultiPoint',
  MultiLineString: 'sites.typeMultiLineString',
  MultiPolygon: 'sites.typeMultiPolygon',
};

const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  Point: 'pin-outline',
  LineString: 'analytics-outline',
  Polygon: 'shapes-outline',
  MultiPoint: 'pin',
  MultiLineString: 'analytics',
  MultiPolygon: 'shapes',
};

export type DrawType = 'Point' | 'LineString' | 'Polygon';

type Props = {
  visible: boolean;
  currentSiteId: number | null;
  /** When set, sites in this project are listed first. */
  preferredProjectId?: number;
  onCancel: () => void;
  /** Pass null to detach the current site. */
  onAssign: (siteId: number | null) => void;
  /** Open map drawing mode with chosen geometry type; caller auto-assigns on save. */
  onCreateNew: (drawType: DrawType) => void;
};

export function SiteAssignSheet({
  visible,
  currentSiteId,
  preferredProjectId,
  onCancel,
  onAssign,
  onCreateNew,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [sites, setSites] = useState<SiteWithProject[]>([]);

  useEffect(() => {
    if (visible) setSites(listSites());
  }, [visible]);

  // Sort: current project first, then by updated_at desc (already from listSites)
  const sortedSites = [...sites].sort((a, b) => {
    if (preferredProjectId !== undefined) {
      if (a.project_id === preferredProjectId && b.project_id !== preferredProjectId) return -1;
      if (a.project_id !== preferredProjectId && b.project_id === preferredProjectId) return 1;
    }
    return b.updated_at - a.updated_at;
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1">
        <Pressable
          onPress={onCancel}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.4)',
          }}
        />
        <View
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: insets.bottom + 8 }}
          className="rounded-t-2xl bg-white dark:bg-gray-900"
        >
          <View className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
            <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('sheets.assignSite')}</Text>
            <Text className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {t('sheets.assignSiteDesc')}
            </Text>
          </View>

          <View className="border-b border-gray-100 dark:border-gray-800 bg-blue-50 dark:bg-blue-950/40">
            <View className="px-4 pb-2 pt-3">
              <Text className="text-xs font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300">
                {t('sheets.newSite')}
              </Text>
            </View>
            <View className="flex-row gap-2 px-4 pb-3">
              <NewSiteButton icon="pin-outline" label={t('sheets.btnPoint')} onPress={() => onCreateNew('Point')} />
              <NewSiteButton icon="analytics-outline" label={t('sheets.btnLine')} onPress={() => onCreateNew('LineString')} />
              <NewSiteButton icon="shapes-outline" label={t('sheets.btnPolygon')} onPress={() => onCreateNew('Polygon')} />
            </View>
          </View>

          {currentSiteId !== null ? (
            <Pressable
              onPress={() => onAssign(null)}
              className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-4 py-3 active:bg-gray-100 dark:active:bg-gray-700"
            >
              <Ionicons name="close-circle-outline" size={20} color="#6b7280" style={{ marginRight: 12 }} />
              <Text className="flex-1 text-base text-gray-700 dark:text-gray-300">{t('sheets.removeAssign')}</Text>
            </Pressable>
          ) : null}

          <ScrollView className="max-h-96">
            {sortedSites.length === 0 ? (
              <View className="px-4 py-6">
                <Text className="text-center text-sm text-gray-500 dark:text-gray-400">
                  {t('sheets.emptySites')}
                </Text>
              </View>
            ) : (
              sortedSites.map((s) => {
                const active = s.id === currentSiteId;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => onAssign(s.id)}
                    className={`flex-row items-center border-b border-gray-100 dark:border-gray-800 px-4 py-3 ${active ? 'bg-blue-50 dark:bg-blue-950/40' : 'active:bg-gray-50 dark:active:bg-gray-800'}`}
                  >
                    <Ionicons
                      name={TYPE_ICON[s.geometry_type] ?? 'pin-outline'}
                      size={20}
                      color={active ? '#2563eb' : '#6b7280'}
                      style={{ marginRight: 12 }}
                    />
                    <View className="flex-1">
                      <Text
                        className={`text-base ${active ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'}`}
                        numberOfLines={1}
                      >
                        {s.name}
                      </Text>
                      <Text className="text-xs text-gray-500 dark:text-gray-400" numberOfLines={1}>
                        {t(TYPE_LABEL[s.geometry_type] ?? '') || s.geometry_type} · {s.project_name}
                      </Text>
                    </View>
                    {active ? <Ionicons name="checkmark" size={20} color="#2563eb" /> : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function NewSiteButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 flex-row items-center justify-center rounded-lg bg-blue-500 py-2.5 active:bg-blue-600"
    >
      <Ionicons name={icon} size={16} color="white" />
      <Text className="ml-1 text-sm font-semibold text-white">{label}</Text>
    </Pressable>
  );
}
