import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  endPlotSurvey,
  getPlotSurvey,
  getProject,
  listPlotSpecies,
  plotCanAcceptSpecies,
  reopenPlotSurvey,
  updatePlotSurvey,
  type AbundanceMethod,
  type PlotSurvey,
  type Project,
  LAYERS,
  LAYER_LABEL,
} from '~/db';
import { PlotSpeciesTab } from '~/components/PlotSpeciesTab';
import { ProjectAssignSheet } from '~/components/ProjectAssignSheet';
import { TransectTrackControl } from '~/components/TransectTrackControl';
import { useActivePlot } from '~/stores/activePlot';

type Tab = 'env' | 'species' | 'layers';

export default function PlotDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const plotId = Number(id);
  const [plot, setPlot] = useState<PlotSurvey | null>(null);
  const [tab, setTab] = useState<Tab>('env');
  const [speciesCount, setSpeciesCount] = useState(0);
  const refreshActivePlot = useActivePlot((s) => s.refresh);

  const reload = useCallback(() => {
    const p = getPlotSurvey(plotId);
    setPlot(p);
    if (p) setSpeciesCount(listPlotSpecies(p.id).length);
    refreshActivePlot();
  }, [plotId, refreshActivePlot]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!plot) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Stack.Screen options={{ title: '樣區' }} />
        <Text className="text-gray-500 dark:text-gray-400">找不到此樣區</Text>
      </SafeAreaView>
    );
  }

  const ready = plotCanAcceptSpecies(plot);

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen
        options={{
          title: plot.plotid,
          headerRight: () => (
            <Pressable
              onPress={() => {
                if (plot.status === 'done') {
                  reopenPlotSurvey(plot.id);
                  reload();
                } else {
                  Alert.alert('結束樣區?', '結束後仍可重新開啟編輯。', [
                    { text: '取消', style: 'cancel' },
                    {
                      text: '結束',
                      onPress: () => {
                        endPlotSurvey(plot.id);
                        reload();
                      },
                    },
                  ]);
                }
              }}
              hitSlop={8}
            >
              <Text className="text-base font-medium text-blue-600 dark:text-blue-400">
                {plot.status === 'done' ? '重開' : '結束'}
              </Text>
            </Pressable>
          ),
        }}
      />
      <View className="flex-row border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <TabBtn label="環境" active={tab === 'env'} onPress={() => setTab('env')} />
        <TabBtn
          label={`物種 ${speciesCount > 0 ? speciesCount : ''}`}
          active={tab === 'species'}
          onPress={() => setTab('species')}
          disabled={!ready}
        />
        {plot.plot_type === 'transect' ? null : (
          <TabBtn label="分層" active={tab === 'layers'} onPress={() => setTab('layers')} />
        )}
      </View>

      <View className="flex-1">
        {/* EnvTab / LayersTab each wrap their content in a ScrollView with
            `keyboardShouldPersistTaps="handled"`, which natively scrolls the
            focused TextInput above the keyboard — no outer KAV needed.
            PlotSpeciesTab wraps its SearchBox in KeyboardStickyView so the
            search row follows the kbd top across accessory-bar changes. */}
        {tab === 'env' ? <EnvTab plot={plot} onUpdated={reload} /> : null}
        {tab === 'species' ? (
          ready ? (
            <PlotSpeciesTab plot={plot} onChanged={reload} />
          ) : (
            <SpeciesGateScreen />
          )
        ) : null}
        {tab === 'layers' ? <LayersTab plot={plot} onUpdated={reload} /> : null}
      </View>
    </SafeAreaView>
  );
}

function TabBtn({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      className={`flex-1 items-center justify-center py-3 ${active ? 'border-b-2 border-emerald-500' : ''}`}
    >
      <Text
        className={`text-sm font-medium ${
          disabled ? 'text-gray-300' : active ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-600 dark:text-gray-400'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Env Tab
// ─────────────────────────────────────────────────────────────────────

function EnvTab({ plot, onUpdated }: { plot: PlotSurvey; onUpdated: () => void }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    setProject(getProject(plot.project_id));
  }, [plot.project_id]);

  const patch = (p: Parameters<typeof updatePlotSurvey>[1]) => {
    updatePlotSurvey(plot.id, p);
    onUpdated();
  };

  const captureGps = async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('需要定位權限', '請至 設定 → Checklister → 位置 開啟');
      return;
    }
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      patch({
        decimal_latitude: pos.coords.latitude,
        decimal_longitude: pos.coords.longitude,
        coord_uncertainty_m: pos.coords.accuracy ?? null,
        start_ts: plot.start_ts ?? Date.now(),
      });
    } catch (e) {
      Alert.alert('無法取得位置', e instanceof Error ? e.message : String(e));
    }
  };

  const hasGps =
    plot.decimal_latitude !== null &&
    plot.decimal_longitude !== null &&
    plot.coord_uncertainty_m !== null;

  return (
    <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
      <Section title="必填" required>
        <Field
          label="Plotid"
          value={plot.plotid}
          onSave={(v) => patch({ plotid: v })}
          required
        />

        <Pressable
          onPress={() => setProjectSheetOpen(true)}
          className="mt-3 flex-row items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-3 active:bg-gray-50 dark:active:bg-gray-800"
        >
          <Ionicons name="folder-outline" size={18} color="#4b5563" />
          <View className="ml-2 flex-1">
            <Text className="text-xs text-gray-500 dark:text-gray-400">專案</Text>
            <Text
              className={`text-sm ${project?.id === 0 ? 'italic text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}
              numberOfLines={1}
            >
              {project?.name ?? '未分類'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
        </Pressable>

        {plot.plot_type === 'transect' ? (
          <TransectTrackControl plot={plot} onUpdated={onUpdated} />
        ) : (
          <View className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            <View className="flex-row items-center">
              <Text className="flex-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                GPS 座標 + 精度 <Text className="text-red-500">*</Text>
              </Text>
              <Pressable
                onPress={captureGps}
                className="flex-row items-center rounded-md bg-emerald-500 px-3 py-1.5 active:bg-emerald-600"
              >
                <Ionicons name="locate" size={14} color="white" />
                <Text className="ml-1 text-xs font-medium text-white">
                  {hasGps ? '重新抓取' : '抓取座標'}
                </Text>
              </Pressable>
            </View>
            {hasGps ? (
              <Text selectable className="mt-2 text-sm text-gray-900 dark:text-gray-100">
                {plot.decimal_latitude?.toFixed(6)}, {plot.decimal_longitude?.toFixed(6)}
                {'  '}
                <Text className="text-xs text-gray-500 dark:text-gray-400">
                  ±{plot.coord_uncertainty_m?.toFixed(1)} m
                </Text>
              </Text>
            ) : (
              <Text className="mt-2 text-xs text-gray-400 dark:text-gray-500">尚未抓取（物種輸入需此資料）</Text>
            )}
          </View>
        )}

        <Field
          label="樣區大小 (sampleSizeValue)"
          value={plot.sample_size_value !== null ? String(plot.sample_size_value) : ''}
          placeholder="例: 25 或 100"
          keyboardType="decimal-pad"
          onSave={(v) => {
            const n = v.trim() === '' ? null : Number(v);
            patch({ sample_size_value: Number.isFinite(n as number) ? (n as number) : null });
          }}
        />
        <Field
          label="樣區單位 (sampleSizeUnit)"
          value={plot.sample_size_unit ?? ''}
          placeholder="例: square meters / meters"
          onSave={(v) => patch({ sample_size_unit: v || null })}
        />
        <Field
          label="調查法 (samplingProtocol)"
          value={plot.sampling_protocol ?? ''}
          placeholder="例: 方形樣區調查法 / 穿越線調查法"
          onSave={(v) => patch({ sampling_protocol: v || null })}
        />
        <Field
          label="總植被覆蓋度 (totalCoverInPercentage)"
          value={plot.total_cover_pct !== null ? String(plot.total_cover_pct) : ''}
          placeholder="0–100"
          keyboardType="decimal-pad"
          suffix="%"
          onSave={(v) => {
            const n = v.trim() === '' ? null : Number(v);
            patch({ total_cover_pct: Number.isFinite(n as number) ? (n as number) : null });
          }}
        />
        <Field
          label="調查者 (recordedBy)"
          value={plot.recorded_by ?? ''}
          placeholder="例: Cheng-Tao Lin（多人用逗號分隔）"
          onSave={(v) => patch({ recorded_by: v || null })}
        />
      </Section>

      <Section title="位置資訊">
        <Field
          label="地點描述 (locality)"
          value={plot.locality ?? ''}
          placeholder="例: 臺大校園總圖書館旁"
          onSave={(v) => patch({ locality: v || null })}
          multiline
        />
        <Field
          label="備註 (fieldNote)"
          value={plot.field_note ?? ''}
          onSave={(v) => patch({ field_note: v || null })}
          multiline
        />
      </Section>

      <Pressable
        onPress={() => setShowAdvanced((v) => !v)}
        className="mt-2 flex-row items-center justify-between bg-gray-100 dark:bg-gray-800 px-4 py-3"
      >
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300">
          進階（地形、地表覆蓋）
        </Text>
        <Ionicons
          name={showAdvanced ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#4b5563"
        />
      </Pressable>
      {showAdvanced ? (
        <Section title="">
          <NumField
            label="海拔 (elevation)"
            suffix="m"
            value={plot.elevation_m}
            onSave={(n) => patch({ elevation_m: n })}
          />
          <NumField
            label="坡度 (slope)"
            suffix="°"
            value={plot.slope_deg}
            onSave={(n) => patch({ slope_deg: n })}
          />
          <NumField
            label="坡向 (aspect)"
            suffix="°"
            value={plot.aspect_deg}
            onSave={(n) => patch({ aspect_deg: n })}
          />
          <Field
            label="地形位置 (terrainPosition)"
            value={plot.terrain_position ?? ''}
            placeholder="ridge / upper / mid / lower / valley / plain"
            onSave={(v) => patch({ terrain_position: v || null })}
          />
          <NumField
            label="岩石覆蓋"
            suffix="%"
            value={plot.rock_cover_pct}
            onSave={(n) => patch({ rock_cover_pct: n })}
          />
          <NumField
            label="碎石覆蓋"
            suffix="%"
            value={plot.gravel_cover_pct}
            onSave={(n) => patch({ gravel_cover_pct: n })}
          />
          <NumField
            label="裸露地覆蓋"
            suffix="%"
            value={plot.bareland_cover_pct}
            onSave={(n) => patch({ bareland_cover_pct: n })}
          />
        </Section>
      ) : null}

      <View className="h-12" />

      <ProjectAssignSheet
        visible={projectSheetOpen}
        currentProjectId={plot.project_id}
        onCancel={() => setProjectSheetOpen(false)}
        onAssign={(projectId) => {
          patch({ project_id: projectId });
          setProjectSheetOpen(false);
        }}
      />
    </ScrollView>
  );
}

function Section({
  title,
  required,
  children,
}: {
  title: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View className="px-4 py-3">
      {title ? (
        <View className="mb-2 flex-row items-center">
          <Text className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {title}
          </Text>
          {required ? <Text className="ml-1 text-xs text-red-500">*</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

function Field({
  label,
  value,
  placeholder,
  required,
  multiline,
  keyboardType,
  suffix,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  keyboardType?: 'default' | 'decimal-pad' | 'numeric';
  suffix?: string;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const dirty = draft !== value;

  return (
    <View className="mb-3">
      <Text className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">
        {label}
        {required ? <Text className="text-red-500"> *</Text> : null}
      </Text>
      <View className="flex-row items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={() => {
            if (dirty) onSave(draft);
          }}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          multiline={multiline}
          keyboardType={keyboardType}
          className="flex-1 py-2 text-sm text-gray-900 dark:text-gray-100"
        />
        {suffix ? <Text className="ml-1 text-xs text-gray-500 dark:text-gray-400">{suffix}</Text> : null}
      </View>
    </View>
  );
}

function NumField({
  label,
  suffix,
  value,
  onSave,
}: {
  label: string;
  suffix?: string;
  value: number | null;
  onSave: (n: number | null) => void;
}) {
  return (
    <Field
      label={label}
      value={value !== null ? String(value) : ''}
      keyboardType="decimal-pad"
      suffix={suffix}
      onSave={(v) => {
        const n = v.trim() === '' ? null : Number(v);
        onSave(Number.isFinite(n as number) ? (n as number) : null);
      }}
    />
  );
}

function SpeciesGateScreen() {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Ionicons name="lock-closed-outline" size={48} color="#fbbf24" />
      <Text className="mt-3 text-center text-gray-500 dark:text-gray-400">
        請先在「環境」頁填妥 plotid、GPS 座標與精度
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Layers Tab
// ─────────────────────────────────────────────────────────────────────

function LayersTab({ plot, onUpdated }: { plot: PlotSurvey; onUpdated: () => void }) {
  const patch = (p: Parameters<typeof updatePlotSurvey>[1]) => {
    updatePlotSurvey(plot.id, p);
    onUpdated();
  };

  const layerData: Record<
    'E0' | 'E1' | 'E2' | 'E3',
    {
      cover: number | null;
      height: number | null;
      method: AbundanceMethod;
      setCover: (n: number | null) => void;
      setHeight: (n: number | null) => void;
      setMethod: (m: AbundanceMethod) => void;
    }
  > = {
    E0: {
      cover: plot.e0_cover_pct,
      height: plot.e0_height_cm,
      method: plot.e0_method,
      setCover: (n) => patch({ e0_cover_pct: n }),
      setHeight: (n) => patch({ e0_height_cm: n }),
      setMethod: (m) => patch({ e0_method: m }),
    },
    E1: {
      cover: plot.e1_cover_pct,
      height: plot.e1_height_cm,
      method: plot.e1_method,
      setCover: (n) => patch({ e1_cover_pct: n }),
      setHeight: (n) => patch({ e1_height_cm: n }),
      setMethod: (m) => patch({ e1_method: m }),
    },
    E2: {
      cover: plot.e2_cover_pct,
      height: plot.e2_height_cm,
      method: plot.e2_method,
      setCover: (n) => patch({ e2_cover_pct: n }),
      setHeight: (n) => patch({ e2_height_cm: n }),
      setMethod: (m) => patch({ e2_method: m }),
    },
    E3: {
      cover: plot.e3_cover_pct,
      height: plot.e3_height_cm,
      method: plot.e3_method,
      setCover: (n) => patch({ e3_cover_pct: n }),
      setHeight: (n) => patch({ e3_height_cm: n }),
      setMethod: (m) => patch({ e3_method: m }),
    },
  };

  return (
    <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
      <View className="px-4 py-3">
        <Text className="text-xs text-gray-500 dark:text-gray-400">
          各分層獨立設定 cover% / height(cm) / 預設豐度單位。物種輸入時開啟 modal
          會預選此處的單位，但仍可即時切換。
        </Text>
      </View>
      {LAYERS.map((layer) => {
        const d = layerData[layer];
        return (
          <View key={layer} className="border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3">
            <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{LAYER_LABEL[layer]}</Text>
            <View className="mt-2 flex-row gap-3">
              <View className="flex-1">
                <NumField
                  label="Cover"
                  suffix="%"
                  value={d.cover}
                  onSave={d.setCover}
                />
              </View>
              <View className="flex-1">
                <NumField label="Height" suffix="cm" value={d.height} onSave={d.setHeight} />
              </View>
            </View>
            <Text className="mt-1 text-xs font-medium text-gray-600 dark:text-gray-400">預設豐度單位</Text>
            <View className="mt-1 flex-row gap-2">
              {(['BB', 'percent', 'DBH'] as AbundanceMethod[]).map((m) => {
                const on = d.method === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => d.setMethod(m)}
                    className={`rounded-full px-3 py-1.5 ${on ? 'bg-emerald-500' : 'bg-gray-100 dark:bg-gray-800'}`}
                  >
                    <Text className={`text-xs font-medium ${on ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                      {m === 'BB' ? 'Braun-Blanquet' : m === 'percent' ? '百分比 %' : 'DBH'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
      <View className="h-12" />
    </ScrollView>
  );
}
