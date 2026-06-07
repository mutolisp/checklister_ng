import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { BackHeaderLeft } from '~/lib/goBack';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  endPlotSurvey,
  getActiveLayers,
  getPlotLayers,
  getPlotSurvey,
  getProject,
  layerIndexOf,
  layerKeyForIndex,
  listPlotSpecies,
  parseEnvPhotos,
  plotCanAcceptSpecies,
  reopenPlotSurvey,
  setPlotLayerCount,
  updatePlotEnvPhotos,
  updatePlotLayer,
  updatePlotSurvey,
  listSubplots,
  setSubplotCount,
  updateSubplot,
  type Subplot,
  type AbundanceMethod,
  type HeightUnit,
  type FixedLayer,
  type PlotLayer,
  type PlotSurvey,
  type Project,
  LAYER_LABEL,
  MAX_LAYER_COUNT,
} from '~/db';
import { PhotoGrid, PhotoViewerModal } from '~/components/PhotoGrid';
import { useThemeColors } from '~/hooks/useThemeColors';
import { useToast } from '~/stores/toast';
import { PlotSpeciesTab } from '~/components/PlotSpeciesTab';
import { ProjectAssignSheet } from '~/components/ProjectAssignSheet';
import { SurveyorAssignSheet } from '~/components/SurveyorAssignSheet';
import { TransectTrackControl } from '~/components/TransectTrackControl';
import { useActivePlot } from '~/stores/activePlot';
import { useActiveSession } from '~/stores/activeSession';
import { captureEnvPhoto, pickPhotos } from '~/lib/photoCapture';
import { showActionSheet } from '~/components/ActionSheet';

type Tab = 'env' | 'species';

export default function PlotDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const plotId = Number(id);
  const [plot, setPlot] = useState<PlotSurvey | null>(null);
  const [tab, setTab] = useState<Tab>('env');
  const [speciesCount, setSpeciesCount] = useState(0);
  const refreshActivePlot = useActivePlot((s) => s.refresh);
  const refreshActiveSession = useActiveSession((s) => s.refresh);

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
        <Stack.Screen options={{ title: '樣區', headerLeft: BackHeaderLeft }} />
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
          headerLeft: BackHeaderLeft,
          headerRight: () => (
            <Pressable
              onPress={() => {
                if (plot.status === 'done') {
                  reopenPlotSurvey(plot.id);
                  // Reopen force-ends any active session DB-side too; refresh
                  // both stores so the UI bars + watchers reflect reality.
                  refreshActivePlot();
                  refreshActiveSession();
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
      </View>

      <View className="flex-1">
        {/* EnvTab wraps its content in a `KeyboardAwareScrollView` (from
            `react-native-keyboard-controller`) which auto-scrolls the focused
            TextInput above the keyboard. PlotSpeciesTab wraps its SearchBox
            in KeyboardStickyView so the search row follows the kbd top. */}
        {tab === 'env' ? <EnvTab plot={plot} onUpdated={reload} /> : null}
        {tab === 'species' ? (
          ready ? (
            <PlotSpeciesTab plot={plot} onChanged={reload} />
          ) : (
            <SpeciesGateScreen />
          )
        ) : null}
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

/** HH:MM clock for the point-count start/end time buttons. */
function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
}

function EnvTab({ plot, onUpdated }: { plot: PlotSurvey; onUpdated: () => void }) {
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);
  const [surveyorSheetOpen, setSurveyorSheetOpen] = useState(false);
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
        // Grab altitude (海拔) from the same GPS fix; keep existing value if the
        // device couldn't resolve altitude (often null indoors / poor signal).
        elevation_m: pos.coords.altitude != null ? Math.round(pos.coords.altitude) : plot.elevation_m,
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
    <KeyboardAwareScrollView className="flex-1" keyboardShouldPersistTaps="handled" bottomOffset={24}>
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
                GPS 座標 + 精度 + 海拔 <Text className="text-red-500">*</Text>
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
                  {plot.elevation_m != null ? ` · 海拔 ${plot.elevation_m} m` : ''}
                </Text>
              </Text>
            ) : (
              <Text className="mt-2 text-xs text-gray-400 dark:text-gray-500">尚未抓取（物種輸入需此資料）</Text>
            )}
          </View>
        )}

        {plot.plot_type === 'point_count' ? (
          <>
            <Field
              label="計數半徑 (radius)"
              value={plot.point_radius_m !== null ? String(plot.point_radius_m) : ''}
              placeholder="例: 25"
              keyboardType="decimal-pad"
              suffix="m"
              onSave={(v) => {
                const n = v.trim() === '' ? null : Number(v);
                patch({ point_radius_m: Number.isFinite(n as number) ? (n as number) : null });
              }}
            />
            <View className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
              <Text className="text-xs font-medium text-gray-600 dark:text-gray-400">計數時間</Text>
              <View className="mt-2 flex-row gap-2">
                <Pressable
                  onPress={() => patch({ start_ts: Date.now() })}
                  className="flex-1 flex-row items-center justify-center rounded-md bg-gray-100 dark:bg-gray-800 px-3 py-2 active:opacity-70"
                >
                  <Ionicons name="play" size={14} color="#16a34a" />
                  <Text className="ml-1 text-xs text-gray-700 dark:text-gray-300">
                    開始 {plot.start_ts ? fmtClock(plot.start_ts) : '—'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => patch({ stop_ts: Date.now() })}
                  className="flex-1 flex-row items-center justify-center rounded-md bg-gray-100 dark:bg-gray-800 px-3 py-2 active:opacity-70"
                >
                  <Ionicons name="stop" size={14} color="#dc2626" />
                  <Text className="ml-1 text-xs text-gray-700 dark:text-gray-300">
                    結束 {plot.stop_ts ? fmtClock(plot.stop_ts) : '—'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </>
        ) : null}

        <View className="mb-3">
          <Text className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            調查者 (recordedBy)
          </Text>
          <Pressable
            onPress={() => setSurveyorSheetOpen(true)}
            className="flex-row items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <Text
              className={`flex-1 text-sm ${plot.recorded_by ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}
              numberOfLines={1}
            >
              {plot.recorded_by || '點選指派調查者…'}
            </Text>
            <Ionicons name="people-outline" size={16} color="#9ca3af" />
          </Pressable>
        </View>
      </Section>

      <CollapsibleSection title="基本資訊">
        {/* 穿越線不需要樣區大小 / 單位（其尺度由軌跡長度表示）。 */}
        {plot.plot_type !== 'transect' ? (
          <>
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
          </>
        ) : null}
        <Field
          label="調查法 (samplingProtocol)"
          value={plot.sampling_protocol ?? ''}
          placeholder="例: 方形樣區調查法 / 穿越線調查法"
          onSave={(v) => patch({ sampling_protocol: v || null })}
        />
        <NumField
          label="總植被覆蓋度 (totalCoverInPercentage)"
          value={plot.total_cover_pct}
          suffix="%"
          min={0}
          max={100}
          onSave={(n) => patch({ total_cover_pct: n })}
        />
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
      </CollapsibleSection>

      {plot.plot_type === 'fixed' ? (
        <LayerSection plot={plot} onUpdated={onUpdated} />
      ) : null}

      {plot.plot_type === 'fixed' ? (
        <SubplotSection plot={plot} onUpdated={onUpdated} />
      ) : null}

      <CollapsibleSection title="進階（地形、地表覆蓋）">
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
      </CollapsibleSection>

      <EnvPhotoSection plot={plot} onUpdated={onUpdated} />

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
      <SurveyorAssignSheet
        visible={surveyorSheetOpen}
        current={plot.recorded_by ?? ''}
        onCancel={() => setSurveyorSheetOpen(false)}
        onAssign={(v) => {
          patch({ recorded_by: v || null });
          setSurveyorSheetOpen(false);
        }}
      />
    </KeyboardAwareScrollView>
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

/** Section with a tappable header that collapses/expands its body. Matches the
 *  visual style of `Section`; default collapsed to declutter the env tab. */
function CollapsibleSection({
  title,
  defaultExpanded = false,
  children,
}: {
  title: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  return (
    <View className="px-4 py-3">
      <Pressable
        onPress={() => setOpen((o) => !o)}
        className={`flex-row items-center ${open ? 'mb-2' : ''}`}
        hitSlop={6}
      >
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color="#6b7280" />
        <Text className="ml-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {title}
        </Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

function SubplotSection({ plot, onUpdated }: { plot: PlotSurvey; onUpdated: () => void }) {
  // +/- icons sit on a dark button in dark mode — use a bright glyph there.
  const { scheme } = useThemeColors();
  const stepIcon = scheme === 'dark' ? '#f3f4f6' : '#374151';
  const [subplots, setSubplots] = useState<Subplot[]>([]);
  const reload = useCallback(() => setSubplots(listSubplots(plot.id)), [plot.id]);
  useEffect(() => reload(), [reload]);

  // 各小區尺寸相同：開啟後只填一組寬/長套用到全部，省去逐區輸入。
  const [uniform, setUniform] = useState(true);
  // One-time init from existing data: default ON unless subplots already differ.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current || subplots.length === 0) return;
    syncedRef.current = true;
    const { width_m: w, length_m: l } = subplots[0];
    setUniform(subplots.every((s) => s.width_m === w && s.length_m === l));
  }, [subplots]);

  /** Write the same width/length to every subplot. */
  const applyUniform = (fields: { width_m?: number | null; length_m?: number | null }) => {
    for (const s of subplots) updateSubplot(s.id, fields);
    reload();
    onUpdated();
  };

  const count = subplots.length;
  const setCount = (n: number) => {
    if (n < 0) return;
    setSubplotCount(plot.id, n);
    const fresh = listSubplots(plot.id);
    // In uniform mode, newly-added subplots inherit the shared size.
    if (uniform && fresh.length > 0) {
      const { width_m: w, length_m: l } = fresh[0];
      for (const s of fresh) updateSubplot(s.id, { width_m: w, length_m: l });
    }
    setSubplots(listSubplots(plot.id));
    onUpdated();
  };

  const toggleUniform = () => {
    const next = !uniform;
    setUniform(next);
    // Turning ON: propagate the first subplot's size to all so they match.
    if (next && subplots.length > 0) {
      applyUniform({ width_m: subplots[0].width_m, length_m: subplots[0].length_m });
    }
  };

  const first = subplots[0];

  return (
    <CollapsibleSection title="小區劃分 (subplots)">
      <Text className="mb-2 text-[11px] text-gray-500 dark:text-gray-400">
        切分後在「物種」分頁可逐小區記錄物種、豐度與各層 cover/height（分層設定共用）。0 = 不切分。
      </Text>
      <View className="mb-3 flex-row items-center">
        <Pressable
          onPress={() => setCount(count - 1)}
          disabled={count <= 0}
          className={`h-9 w-9 items-center justify-center rounded-full ${count <= 0 ? 'bg-gray-100 dark:bg-gray-800' : 'bg-gray-200 active:bg-gray-300 dark:bg-gray-700 dark:active:bg-gray-600'}`}
        >
          <Ionicons name="remove" size={18} color={count <= 0 ? '#9ca3af' : stepIcon} />
        </Pressable>
        <Text className="mx-4 min-w-[24px] text-center text-lg font-semibold text-gray-900 dark:text-gray-100">
          {count}
        </Text>
        <Pressable
          onPress={() => setCount(count + 1)}
          className="h-9 w-9 items-center justify-center rounded-full bg-gray-200 active:bg-gray-300 dark:bg-gray-700 dark:active:bg-gray-600"
        >
          <Ionicons name="add" size={18} color={stepIcon} />
        </Pressable>
        <Text className="ml-3 text-[11px] text-gray-500 dark:text-gray-400">小區數量</Text>
      </View>

      {count > 0 ? (
        <Pressable onPress={toggleUniform} className="mb-2 flex-row items-center" hitSlop={6}>
          <Ionicons
            name={uniform ? 'checkbox' : 'square-outline'}
            size={20}
            color={uniform ? '#2563eb' : scheme === 'dark' ? '#9ca3af' : '#6b7280'}
          />
          <Text className="ml-2 text-sm text-gray-800 dark:text-gray-200">各小區長寬相同</Text>
        </Pressable>
      ) : null}

      {/* Uniform mode: one shared 寬/長 pair applied to all subplots. */}
      {uniform && count > 0 ? (
        <View className="mb-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2">
          <Text className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">所有小區共用尺寸</Text>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <NumField
                label="寬 (m)"
                value={first?.width_m ?? null}
                onSave={(n) => applyUniform({ width_m: n })}
              />
            </View>
            <View className="flex-1">
              <NumField
                label="長 (m)"
                value={first?.length_m ?? null}
                onSave={(n) => applyUniform({ length_m: n })}
              />
            </View>
          </View>
        </View>
      ) : null}

      {subplots.map((s) => (
        <View
          key={s.id}
          className="mb-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2"
        >
          <Field
            label={`小區 ${s.idx} 名稱`}
            value={s.label}
            onSave={(v) => {
              updateSubplot(s.id, { label: v });
              reload();
            }}
          />
          {/* Per-subplot 寬/長 only when sizes are independent. */}
          {!uniform ? (
            <View className="flex-row gap-3">
              <View className="flex-1">
                <NumField
                  label="寬 (m)"
                  value={s.width_m}
                  onSave={(n) => {
                    updateSubplot(s.id, { width_m: n });
                    reload();
                  }}
                />
              </View>
              <View className="flex-1">
                <NumField
                  label="長 (m)"
                  value={s.length_m}
                  onSave={(n) => {
                    updateSubplot(s.id, { length_m: n });
                    reload();
                  }}
                />
              </View>
            </View>
          ) : null}
        </View>
      ))}
    </CollapsibleSection>
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
  min,
  max,
}: {
  label: string;
  suffix?: string;
  value: number | null;
  onSave: (n: number | null) => void;
  /** Exclusive lower bound — entered value must be strictly greater. */
  min?: number;
  /** Inclusive upper bound — entered value must be ≤ this. */
  max?: number;
}) {
  const toast = useToast((s) => s.show);
  // Bumping this remounts <Field>, resetting its draft to the last saved value
  // (used to discard an out-of-range entry).
  const [resetKey, setResetKey] = useState(0);
  const ranged = min !== undefined || max !== undefined;
  return (
    <Field
      key={resetKey}
      label={label}
      value={value !== null ? String(value) : ''}
      keyboardType="decimal-pad"
      suffix={suffix}
      onSave={(v) => {
        const t = v.trim();
        if (t === '') {
          onSave(null);
          return;
        }
        const n = Number(t);
        if (ranged) {
          const ok =
            Number.isFinite(n) &&
            (min === undefined || n > min) &&
            (max === undefined || n <= max);
          if (!ok) {
            toast(`數值須大於 ${min ?? 0}、小於等於 ${max ?? 100}`);
            setResetKey((k) => k + 1);
            return;
          }
          onSave(n);
          return;
        }
        onSave(Number.isFinite(n) ? n : null);
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
// Layer section (rendered inside EnvTab for fixed plots)
// ─────────────────────────────────────────────────────────────────────

function LayerSection({ plot, onUpdated }: { plot: PlotSurvey; onUpdated: () => void }) {
  // +/- icons sit on a dark button in dark mode — use a bright glyph there.
  const { scheme } = useThemeColors();
  const stepIcon = scheme === 'dark' ? '#f3f4f6' : '#374151';
  const [layers, setLayers] = useState<PlotLayer[]>([]);
  useEffect(() => {
    setLayers(getPlotLayers(plot.id));
  }, [plot.id, plot.layer_count]);

  const activeLayers = getActiveLayers(plot.layer_count);

  const patchLayer = (
    layerIdx: number,
    fields: {
      cover_pct?: number | null;
      height_cm?: number | null;
      height_unit?: HeightUnit;
      method?: AbundanceMethod;
    },
  ) => {
    updatePlotLayer(plot.id, layerIdx, fields);
    setLayers(getPlotLayers(plot.id));
    onUpdated();
  };

  const decrement = () => {
    if (plot.layer_count <= 1) return;
    setPlotLayerCount(plot.id, plot.layer_count - 1);
    onUpdated();
  };
  const increment = () => {
    if (plot.layer_count >= MAX_LAYER_COUNT) return;
    setPlotLayerCount(plot.id, plot.layer_count + 1);
    onUpdated();
  };

  return (
    <CollapsibleSection title="分層 (layer)">
      <View className="mb-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-3">
        <Text className="text-xs font-medium text-gray-600 dark:text-gray-400">分層數量</Text>
        <View className="mt-2 flex-row items-center">
          <Pressable
            onPress={decrement}
            disabled={plot.layer_count <= 1}
            className={`h-9 w-9 items-center justify-center rounded-full ${plot.layer_count <= 1 ? 'bg-gray-100 dark:bg-gray-800' : 'bg-gray-200 active:bg-gray-300 dark:bg-gray-700 dark:active:bg-gray-600'}`}
          >
            <Ionicons
              name="remove"
              size={18}
              color={plot.layer_count <= 1 ? '#9ca3af' : stepIcon}
            />
          </Pressable>
          <Text className="mx-4 min-w-[24px] text-center text-lg font-semibold text-gray-900 dark:text-gray-100">
            {plot.layer_count}
          </Text>
          <Pressable
            onPress={increment}
            disabled={plot.layer_count >= MAX_LAYER_COUNT}
            className={`h-9 w-9 items-center justify-center rounded-full ${plot.layer_count >= MAX_LAYER_COUNT ? 'bg-gray-100 dark:bg-gray-800' : 'bg-gray-200 active:bg-gray-300 dark:bg-gray-700 dark:active:bg-gray-600'}`}
          >
            <Ionicons
              name="add"
              size={18}
              color={plot.layer_count >= MAX_LAYER_COUNT ? '#9ca3af' : stepIcon}
            />
          </Pressable>
          <Text className="ml-3 text-[11px] text-gray-500 dark:text-gray-400">
            1-{MAX_LAYER_COUNT} 層；E1 苔蘚 / E2 草本 / E3 灌木 / E4 亞喬木 / E5 主林冠 / E6 突出
          </Text>
        </View>
      </View>
      <Text className="mb-2 text-[11px] text-gray-500 dark:text-gray-400">
        每層獨立 cover% / height(cm) / 預設豐度單位。物種輸入時 modal 會預選此處單位、可即時切換。
      </Text>
      {activeLayers.map((layerKey) => {
        const idx = layerIndexOf(layerKey as FixedLayer);
        const row = layers.find((l) => l.layer_index === idx) ?? null;
        return (
          <View
            key={layerKey}
            className="mb-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-3"
          >
            <Text className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {LAYER_LABEL[layerKey]}
            </Text>
            <View className="mt-2 flex-row gap-3">
              <View className="flex-1">
                <NumField
                  label="Cover"
                  suffix="%"
                  value={row?.cover_pct ?? null}
                  min={0}
                  max={100}
                  onSave={(n) => patchLayer(idx, { cover_pct: n })}
                />
              </View>
              <View className="flex-1">
                {(() => {
                  const unit: HeightUnit = row?.height_unit ?? 'cm';
                  const display =
                    row?.height_cm == null ? null : unit === 'm' ? row.height_cm / 100 : row.height_cm;
                  return (
                    <>
                      <NumField
                        label="Height"
                        suffix={unit}
                        value={display}
                        onSave={(n) =>
                          patchLayer(idx, {
                            height_cm: n == null ? null : unit === 'm' ? n * 100 : n,
                          })
                        }
                      />
                      <View className="-mt-1 flex-row gap-1">
                        {(['cm', 'm'] as HeightUnit[]).map((u) => {
                          const on = unit === u;
                          return (
                            <Pressable
                              key={u}
                              onPress={() => patchLayer(idx, { height_unit: u })}
                              className={`rounded px-2 py-0.5 ${on ? 'bg-emerald-500' : 'bg-gray-100 dark:bg-gray-800'}`}
                            >
                              <Text
                                className={`text-[11px] font-medium ${on ? 'text-white' : 'text-gray-600 dark:text-gray-300'}`}
                              >
                                {u}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  );
                })()}
              </View>
            </View>
            <Text className="mt-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              預設豐度單位
            </Text>
            <View className="mt-1 flex-row gap-2">
              {(['BB', 'percent', 'DBH'] as AbundanceMethod[]).map((m) => {
                const on = row?.method === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => patchLayer(idx, { method: m })}
                    className={`rounded-full px-3 py-1.5 ${on ? 'bg-emerald-500' : 'bg-gray-100 dark:bg-gray-800'}`}
                  >
                    <Text
                      className={`text-xs font-medium ${on ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}
                    >
                      {m === 'BB' ? 'Braun-Blanquet' : m === 'percent' ? '百分比 %' : 'DBH'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </CollapsibleSection>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Env photo section
// ─────────────────────────────────────────────────────────────────────

function EnvPhotoSection({ plot, onUpdated }: { plot: PlotSurvey; onUpdated: () => void }) {
  const photos = parseEnvPhotos(plot.env_photos_json);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const append = (uris: string[]) => {
    if (uris.length === 0) return;
    updatePlotEnvPhotos(plot.id, [...photos, ...uris]);
    onUpdated();
  };
  const remove = (uri: string) => {
    updatePlotEnvPhotos(
      plot.id,
      photos.filter((u) => u !== uri),
    );
    onUpdated();
  };

  const handleAdd = async () => {
    const choice = await showActionSheet({
      title: '加入環境照片',
      options: [{ label: '拍照' }, { label: '從相簿選擇' }],
    });
    if (choice === 0) {
      try {
        const uri = await captureEnvPhoto();
        if (uri) append([uri]);
      } catch (e) {
        Alert.alert('拍照失敗', e instanceof Error ? e.message : String(e));
      }
    } else if (choice === 1) {
      try {
        const uris = await pickPhotos();
        append(uris);
      } catch (e) {
        Alert.alert('選擇照片失敗', e instanceof Error ? e.message : String(e));
      }
    }
  };

  return (
    <View className="px-4 py-3">
      <View className="mb-2 flex-row items-center">
        <Text className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          環境照片
        </Text>
        {photos.length > 0 ? (
          <Text className="ml-2 text-xs text-gray-500 dark:text-gray-400">
            ({photos.length})
          </Text>
        ) : null}
      </View>
      <Text className="mb-2 text-[11px] text-gray-500 dark:text-gray-400">
        匯出時自動命名為 {plot.plotid || '<plotid>'}_YYYYMMDD_env-N.jpg
      </Text>
      <PhotoGrid
        photos={photos}
        onAdd={handleAdd}
        onView={(idx) => setViewerIndex(idx)}
        onRemove={remove}
      />
      <PhotoViewerModal
        photos={photos}
        index={viewerIndex}
        onClose={() => setViewerIndex(null)}
      />
    </View>
  );
}
