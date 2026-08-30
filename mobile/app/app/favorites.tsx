import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router, Stack, type Href } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { strToU8 } from 'fflate';
import { DOCX_MIME } from '~/lib/docx';
import { buildFavoritesCsv, buildFavoritesDocx } from '~/lib/favoritesExport';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  BackHandler,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DEFAULT_FOLDER_ID,
  listRecords,
  searchByTaxonId,
  type FavoriteFolder,
  type FavoriteItem,
  type RecordItem,
  type SearchResult,
} from '~/db';
import { KeyboardStickyView } from '~/components/KeyboardAvoidingView';
import { LookupResultSheet } from '~/components/LookupResultSheet';
import { ScientificName } from '~/components/ScientificName';
import { SearchBox } from '~/components/SearchBox';
import { BatchImportModal } from '~/components/BatchImportModal';
import { RecordPickerSheet } from '~/components/RecordPickerSheet';
import { SwipeRowActions } from '~/components/SwipeRowActions';
import { showActionSheet, type ActionSheetOption } from '~/components/ActionSheet';
import { promptText } from '~/components/TextPromptModal';
import { useAddToActiveRecord } from '~/lib/useAddToActiveRecord';
import { useFavorites } from '~/stores/favorites';
import { useToast } from '~/stores/toast';
import { FolderAreaMap } from '~/components/FolderAreaMap';

type SortKey = 'added' | 'cname' | 'name' | 'family';
const SORT_LABEL: Record<SortKey, string> = {
  added: 'favorites.sortAdded',
  cname: 'session.sortCname',
  name: 'session.sortName',
  family: 'session.sortFamily',
};

export default function FavoritesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const folders = useFavorites((s) => s.folders);
  // 必須訂閱 items 這個「值」。訂閱 store 的 itemsIn 函式會拿到永遠不變的
  // 參考，元件就不會因為 items 改變而重新 render —— 加入物種後清單不更新，
  // 要切出目錄再切回來才看得到。
  const allItems = useFavorites((s) => s.items);
  const add = useFavorites((s) => s.add);
  const remove = useFavorites((s) => s.remove);
  const createFolder = useFavorites((s) => s.createFolder);
  const renameFolder = useFavorites((s) => s.renameFolder);
  const deleteFolder = useFavorites((s) => s.deleteFolder);
  const moveItem = useFavorites((s) => s.moveItem);
  const importFromRecord = useFavorites((s) => s.importFromRecord);
  const refreshFavorites = useFavorites((s) => s.refresh);
  const toast = useToast((s) => s.show);
  const { addSpecies, promptAddDestination, modal: addRecordModal } = useAddToActiveRecord();

  /** null = folder list; a number = that folder's species list. Kept as screen
   *  state rather than a nested route so the whole feature stays one file and
   *  needs no typed-route cast. */
  const [folderId, setFolderId] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [pickerRecords, setPickerRecords] = useState<RecordItem[] | null>(null);
  /** Multi-select mode for bulk delete. Swiping is disabled while it is on so a
   *  stray gesture can't delete a row the user is only trying to tick. */
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  /** Selection over FOLDERS, on the list view. Separate from `picked`, which
   *  selects species inside one folder — the two views never coexist. */
  const [folderSelectMode, setFolderSelectMode] = useState(false);
  const [pickedFolders, setPickedFolders] = useState<Set<number>>(new Set());

  const current = folders.find((f) => f.id === folderId) ?? null;

  /** Hand off to the map to (re)draw this list's area. The map saves it back
   *  and bounces here, the same shape as the existing site-drawing handoff. */
  const editArea = () => {
    if (folderId == null) return;
    router.push(`/(tabs)/map?draw=Polygon&favoriteArea=${folderId}` as Href);
  };

  /** Memoised so the list does not hand VirtualizedList a brand-new header
   *  element on every render — that remounts the MapView inside it, and
   *  repeatedly mounting a native map view is not something to do on a scroll. */
  const areaHeader = useMemo(
    () => (
      <FolderAreaMap
        areaGeoJson={current?.area_geojson ?? ''}
        source={current?.source ?? ''}
        onEdit={editArea}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current?.area_geojson, current?.source, folderId],
  );
  const folderLabel = (f: FavoriteFolder) => (f.is_default ? t('favorites.defaultFolder') : f.name);

  // Android hardware back should leave the folder, not the screen. BackHandler
  // is a no-op on iOS, so this needs no Platform branch.
  //
  // The listener reads folderId through a ref and subscribes with EMPTY deps on
  // purpose. Closing over folderId (and depending on it) re-subscribes on every
  // navigation, and any listener that outlives its cleanup keeps returning true
  // with a stale folder id — which swallows Back forever. One stable listener
  // cannot go stale.
  const folderIdRef = useRef(folderId);
  folderIdRef.current = folderId;
  // Read through refs for the same reason as folderId: one stable listener that
  // cannot go stale. Back unwinds one level at a time — select mode, then the
  // folder, then the screen.
  const selectModeRef = useRef(selectMode);
  selectModeRef.current = selectMode;
  const folderSelectRef = useRef(folderSelectMode);
  folderSelectRef.current = folderSelectMode;
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (folderSelectRef.current) {
          exitFolderSelect();
          return true;
        }
        if (selectModeRef.current) {
          exitSelect();
          return true;
        }
        if (folderIdRef.current == null) return false;
        setFolderId(null);
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  const items = useMemo(
    () => (folderId == null ? [] : allItems.filter((i) => i.folder_id === folderId)),
    [allItems, folderId],
  );

  const display = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? items.filter(
          (i) =>
            i.common_name_c.toLowerCase().includes(q) ||
            i.simple_name.toLowerCase().includes(q) ||
            i.family.toLowerCase().includes(q) ||
            i.family_c.toLowerCase().includes(q),
        )
      : items;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'cname':
          return (a.common_name_c || a.simple_name).localeCompare(
            b.common_name_c || b.simple_name,
            'zh-Hant',
          );
        case 'name':
          return a.simple_name.localeCompare(b.simple_name);
        case 'family':
          return (
            (a.family_c || a.family).localeCompare(b.family_c || b.family, 'zh-Hant') ||
            a.simple_name.localeCompare(b.simple_name)
          );
        case 'added':
        default:
          return b.added_at - a.added_at;
      }
    });
    return sorted;
  }, [items, filter, sortKey]);

  const handleSort = async () => {
    const keys: SortKey[] = ['added', 'cname', 'name', 'family'];
    const idx = await showActionSheet({
      title: t('favorites.sortTitle'),
      options: keys.map((k) => ({ label: k === sortKey ? `✓ ${t(SORT_LABEL[k])}` : t(SORT_LABEL[k]) })),
    });
    if (idx >= 0 && idx < keys.length) setSortKey(keys[idx]);
  };

  const openDetail = (taxonId: string) => {
    const r = searchByTaxonId(taxonId);
    if (r) setSelected(r);
    else toast(t('favorites.notInDb'));
  };


  // ── 匯入 ────────────────────────────────────────────────────────────
  /** 從既有的名錄／樣區／標本把物種複製進目前目錄（可多選）。 */
  const handleImportFromRecord = () => {
    if (folderId == null) return;
    const records = listRecords('all').filter((r) => r.recordCount > 0);
    if (records.length === 0) {
      toast(t('favorites.noRecordsToImport'));
      return;
    }
    setPickerRecords(records);
  };

  const handlePickerConfirm = (picked: RecordItem[]) => {
    setPickerRecords(null);
    if (folderId == null || picked.length === 0) return;
    // Accumulate across records so the user gets one honest total rather than
    // a burst of toasts; duplicates across the picked records land in skipped.
    let added = 0;
    let skipped = 0;
    let unresolved = 0;
    for (const rec of picked) {
      const r = importFromRecord(rec.kind, rec.id, folderId);
      added += r.added;
      skipped += r.skipped;
      unresolved += r.unresolved;
    }
    toast(t('favorites.importDone', { added, skipped, unresolved }));
  };

  const handleImportMenu = async () => {
    const idx = await showActionSheet({
      title: t('favorites.import'),
      options: [
        { label: t('favorites.importPaste') },
        { label: t('favorites.importFromRecord') },
      ],
    });
    if (idx === 0) setBatchOpen(true);
    else if (idx === 1) handleImportFromRecord();
  };

  // ── folder actions ──────────────────────────────────────────────────
  const handleNewFolder = async () => {
    const name = await promptText({
      title: t('favorites.newFolder'),
      placeholder: t('favorites.folderNamePlaceholder'),
    });
    if (!name?.trim()) return;
    createFolder(name);
    toast(t('favorites.folderCreated', { name: name.trim() }));
  };

  const togglePickFolder = (id: number) =>
    setPickedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitFolderSelect = () => {
    setFolderSelectMode(false);
    setPickedFolders(new Set());
  };

  /** The seeded list is the quick-add target, so it must always exist. */
  const deletableFolders = folders.filter((f) => f.id !== DEFAULT_FOLDER_ID);

  const confirmDeleteFolder = (f: FavoriteFolder) => {
    Alert.alert(
      t('favorites.deleteFolder'),
      t('favorites.deleteFolderConfirm', { name: folderLabel(f), count: f.species_count }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            deleteFolder(f.id);
            toast(t('favorites.folderDeleted', { name: folderLabel(f) }));
          },
        },
      ],
    );
  };

  const handleBulkDeleteFolders = () => {
    const targets = deletableFolders.filter((f) => pickedFolders.has(f.id));
    if (targets.length === 0) return;
    const species = targets.reduce((n, f) => n + f.species_count, 0);
    Alert.alert(
      t('favorites.deleteFolder'),
      t('favorites.deleteFoldersConfirm', { count: targets.length, species }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            for (const f of targets) deleteFolder(f.id);
            toast(t('favorites.foldersDeleted', { count: targets.length }));
            exitFolderSelect();
          },
        },
      ],
    );
  };

  /**
   * Export one list as a document or a spreadsheet.
   *
   * Single file, not a zip — a 常用名錄 has no photos or tracks to carry, so
   * wrapping one document in an archive would only add a step before the user
   * can open it.
   */
  const handleExportFolder = async (f: FavoriteFolder) => {
    const idx = await showActionSheet({
      title: folderLabel(f),
      options: [{ label: t('favorites.exportDocx') }, { label: t('favorites.exportCsv') }],
    });
    if (idx < 0) return;
    const rows = allItems.filter((i) => i.folder_id === f.id);
    if (rows.length === 0) {
      toast(t('favorites.exportEmpty'));
      return;
    }
    try {
      const docx = idx === 0;
      const bytes = docx
        ? buildFavoritesDocx(folderLabel(f), rows)
        : strToU8(buildFavoritesCsv(rows));
      // Date + count basename: the existing filename sanitiser strips CJK, so a
      // Chinese list name would become a row of underscores.
      const stamp = new Date().toISOString().slice(0, 10);
      const filename = `favorites_${stamp}_${rows.length}.${docx ? 'docx' : 'csv'}`;
      const file = new File(Paths.cache, filename);
      if (file.exists) file.delete();
      file.create();
      file.write(bytes);
      // iOS cannot present the share sheet over a dismissing sheet.
      await new Promise((r) => setTimeout(r, 450));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: docx ? DOCX_MIME : 'text/csv',
          UTI: docx ? 'org.openxmlformats.wordprocessingml.document' : 'public.comma-separated-values-text',
          dialogTitle: filename,
        });
      } else {
        Alert.alert(t('export.shareUnavailable'), t('export.fileGenerated', { uri: file.uri }));
      }
    } catch (e) {
      Alert.alert(t('export.failed'), e instanceof Error ? e.message : String(e));
    }
  };

  const handleFolderLongPress = async (f: FavoriteFolder) => {
    const canDelete = f.id !== DEFAULT_FOLDER_ID;
    const opts: ActionSheetOption[] = [{ label: t('favorites.renameFolder') }];
    if (canDelete) opts.push({ label: t('favorites.deleteFolder'), destructive: true });
    const idx = await showActionSheet({ title: folderLabel(f), options: opts });
    if (idx === 0) {
      const name = await promptText({
        title: t('favorites.renameFolder'),
        defaultValue: f.is_default ? t('favorites.defaultFolder') : f.name,
      });
      if (name?.trim()) renameFolder(f.id, name);
    } else if (idx === 1 && canDelete) {
      Alert.alert(
        t('favorites.deleteFolder'),
        t('favorites.deleteFolderConfirm', { name: f.name, count: f.species_count }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: () => {
              deleteFolder(f.id);
              toast(t('favorites.folderDeleted', { name: f.name }));
            },
          },
        ],
      );
    }
  };

  // ── species actions ─────────────────────────────────────────────────
  /** Remove from THIS folder only — the same taxon may legitimately live in
   *  others, so scoping matters here (unlike the star toggle on species rows,
   *  which means "anywhere" and clears everywhere). */
  const removeHere = (item: FavoriteItem) => {
    remove(item.taxon_id, item.folder_id);
    toast(t('favorites.removed'));
  };

  const togglePick = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelect = () => {
    setSelectMode(false);
    setPicked(new Set());
  };

  const handleBulkDelete = () => {
    if (picked.size === 0 || folderId == null) return;
    const targets = items.filter((i) => picked.has(i.id));
    Alert.alert(
      t('favorites.deleteSelected'),
      t('favorites.deleteSelectedConfirm', { count: targets.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            for (const item of targets) remove(item.taxon_id, item.folder_id);
            toast(t('favorites.deletedCount', { count: targets.length }));
            exitSelect();
          },
        },
      ],
    );
  };

  const handleLongPress = async (item: FavoriteItem) => {
    const others = folders.filter((f) => f.id !== item.folder_id);
    const opts: ActionSheetOption[] = [{ label: t('favorites.addToRecord') }];
    if (others.length > 0) opts.push({ label: t('favorites.moveTo') });
    opts.push({ label: t('favorites.removeFromFolder'), destructive: true });

    const idx = await showActionSheet({
      title: item.common_name_c || item.simple_name,
      options: opts,
    });
    if (idx === 0) {
      const r = searchByTaxonId(item.taxon_id);
      if (!r) {
        toast(t('favorites.notInDb'));
        return;
      }
      // Ask which record it goes to rather than assuming the active one — from
      // a curated list the user is usually filling a specific plot/session.
      await promptAddDestination(r);
      return;
    }
    if (others.length > 0 && idx === 1) {
      const pick = await showActionSheet({
        title: t('favorites.moveTo'),
        options: others.map((f) => ({ label: folderLabel(f) })),
      });
      if (pick >= 0 && pick < others.length) {
        moveItem(item.id, others[pick].id);
        toast(t('favorites.movedTo', { name: folderLabel(others[pick]) }));
      }
      return;
    }
    if (idx === opts.length - 1) removeHere(item);
  };

  // ── folder list view ────────────────────────────────────────────────
  if (folderId == null) {
    return (
      <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
        <Stack.Screen options={{ title: t('nav.favorites') }} />
        <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2">
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            {folderSelectMode
              ? t('favorites.selectedFolders', { count: pickedFolders.size })
              : t('favorites.folderCount', { count: folders.length })}
          </Text>
          {folderSelectMode ? (
            <View className="flex-row items-center gap-3">
              <Pressable
                onPress={() =>
                  setPickedFolders(
                    pickedFolders.size === deletableFolders.length
                      ? new Set()
                      : new Set(deletableFolders.map((f) => f.id)),
                  )
                }
                hitSlop={8}
              >
                <Text className="text-sm text-blue-600 dark:text-blue-400">
                  {pickedFolders.size === deletableFolders.length && deletableFolders.length > 0
                    ? t('favorites.deselectAll')
                    : t('favorites.selectAll')}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleBulkDeleteFolders}
                disabled={pickedFolders.size === 0}
                hitSlop={8}
              >
                <Text
                  className={`text-sm font-medium ${
                    pickedFolders.size === 0
                      ? 'text-gray-300 dark:text-gray-600'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {t('common.delete')}
                </Text>
              </Pressable>
              <Pressable onPress={exitFolderSelect} hitSlop={8}>
                <Text className="text-sm text-gray-500 dark:text-gray-400">
                  {t('common.cancel')}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-row items-center gap-2">
              {deletableFolders.length > 0 ? (
                <Pressable
                  onPress={() => setFolderSelectMode(true)}
                  hitSlop={8}
                  className="rounded-full bg-gray-100 p-1.5 active:bg-gray-200 dark:bg-gray-800 dark:active:bg-gray-700"
                >
                  <Ionicons name="checkbox-outline" size={16} color="#4b5563" />
                </Pressable>
              ) : null}
              <Pressable
                onPress={handleNewFolder}
                className="flex-row items-center rounded-full bg-blue-50 dark:bg-blue-900/40 px-3 py-1.5 active:opacity-70"
              >
                <Ionicons name="add" size={16} color="#2563eb" />
                <Text className="ml-1 text-xs font-medium text-blue-600 dark:text-blue-400">
                  {t('favorites.newFolder')}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
        <FlatList
          data={folders}
          keyExtractor={(f) => String(f.id)}
          ListEmptyComponent={
            <View className="px-4 py-16">
              <Text className="text-center text-sm text-gray-500 dark:text-gray-400">
                {t('favorites.emptyFolders')}
              </Text>
            </View>
          }
          renderItem={({ item: f }) => (
            // Delete sits last per SwipeRowActions' convention, and swiping is
            // off while selecting so a gesture cannot delete a row the user is
            // only ticking. The seeded list has no delete action at all.
            <SwipeRowActions
              disabled={folderSelectMode}
              actions={[
                {
                  label: t('common.export'),
                  icon: 'share-outline',
                  color: 'blue',
                  onPress: () => handleExportFolder(f),
                },
                ...(f.id === DEFAULT_FOLDER_ID
                  ? []
                  : [
                      {
                        label: t('common.delete'),
                        icon: 'trash-outline' as const,
                        color: 'red' as const,
                        onPress: () => confirmDeleteFolder(f),
                      },
                    ]),
              ]}
            >
            <Pressable
              onPress={() => {
                if (folderSelectMode) {
                  if (f.id !== DEFAULT_FOLDER_ID) togglePickFolder(f.id);
                  return;
                }
                setFolderId(f.id);
                setFilter('');
                setSelectMode(false);
                setPicked(new Set());
              }}
              onLongPress={() => (folderSelectMode ? undefined : handleFolderLongPress(f))}
              className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
            >
              {folderSelectMode ? (
                <Ionicons
                  name={pickedFolders.has(f.id) ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={
                    f.id === DEFAULT_FOLDER_ID
                      ? '#d1d5db'
                      : pickedFolders.has(f.id)
                        ? '#2563eb'
                        : '#9ca3af'
                  }
                  style={{ marginRight: 12 }}
                />
              ) : null}
              <Ionicons
                name={f.is_default ? 'star' : 'folder-outline'}
                size={20}
                color={f.is_default ? '#f59e0b' : '#6b7280'}
              />
              <View className="ml-3 flex-1">
                <Text className="text-base text-gray-900 dark:text-gray-100">{folderLabel(f)}</Text>
                {f.note ? (
                  <Text className="text-xs text-gray-500 dark:text-gray-400" numberOfLines={1}>
                    {f.note}
                  </Text>
                ) : null}
              </View>
              <Text className="mr-1 text-sm text-gray-500 dark:text-gray-400">
                {t('favorites.count', { count: f.species_count })}
              </Text>
              {folderSelectMode ? null : (
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              )}
            </Pressable>
            </SwipeRowActions>
          )}
        />
        {addRecordModal}
      </SafeAreaView>
    );
  }

  // ── species list view (one folder) ──────────────────────────────────
  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ title: current ? folderLabel(current) : t('nav.favorites') }} />
      {/* Content (back row + toolbar + filter + list) fills above the bottom
          search box. The KeyboardStickyView search box is a SIBLING of this
          flex-1 View (not a child) so keyboard translation lifts only the
          search box, not the list — mirrors the session detail screen. */}
      <View className="flex-1">
        <Pressable
          onPress={() => setFolderId(null)}
          className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2 active:bg-gray-50 dark:active:bg-gray-800"
        >
          <Ionicons name="chevron-back" size={16} color="#2563eb" />
          <Text className="ml-1 text-sm text-blue-600 dark:text-blue-400">
            {t('favorites.allFolders')}
          </Text>
        </Pressable>

        <View className="flex-row items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2">
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            {selectMode
              ? t('favorites.selectedCount', { count: picked.size })
              : t('favorites.count', { count: items.length })}
          </Text>
          {selectMode ? (
            <View className="flex-row items-center gap-3">
              <Pressable
                onPress={() =>
                  setPicked(
                    picked.size === display.length
                      ? new Set()
                      : new Set(display.map((i) => i.id)),
                  )
                }
                hitSlop={8}
              >
                <Text className="text-sm text-blue-600 dark:text-blue-400">
                  {picked.size === display.length && display.length > 0
                    ? t('favorites.deselectAll')
                    : t('favorites.selectAll')}
                </Text>
              </Pressable>
              <Pressable onPress={handleBulkDelete} disabled={picked.size === 0} hitSlop={8}>
                <Text
                  className={`text-sm font-medium ${
                    picked.size === 0
                      ? 'text-gray-300 dark:text-gray-600'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {t('common.delete')}
                </Text>
              </Pressable>
              <Pressable onPress={exitSelect} hitSlop={8}>
                <Text className="text-sm text-gray-500 dark:text-gray-400">
                  {t('common.cancel')}
                </Text>
              </Pressable>
            </View>
          ) : (
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => setSelectMode(true)}
              hitSlop={8}
              className="rounded-full bg-gray-100 dark:bg-gray-800 p-1.5 active:bg-gray-200 dark:active:bg-gray-700"
            >
              <Ionicons name="checkbox-outline" size={16} color="#4b5563" />
            </Pressable>
            <Pressable
              onPress={handleImportMenu}
              className="flex-row items-center rounded-full bg-blue-50 dark:bg-blue-900/40 px-3 py-1.5 active:opacity-70"
            >
              <Ionicons name="download-outline" size={14} color="#2563eb" />
              <Text className="ml-1 text-xs font-medium text-blue-600 dark:text-blue-400">
                {t('favorites.import')}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSort}
              className="flex-row items-center rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-1.5 active:bg-gray-200 dark:active:bg-gray-700"
            >
              <Ionicons name="swap-vertical" size={14} color="#4b5563" />
              <Text className="ml-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                {t(SORT_LABEL[sortKey])}
              </Text>
            </Pressable>
          </View>
          )}
        </View>

        {/* Always visible, and deliberately NOT autoFocused: one area import can
            put a thousand species in here, so the search has to be findable —
            but popping the keyboard every time a list is opened would fight the
            far commoner case of just browsing it. */}
        <View className="border-b border-gray-100 bg-white px-4 py-2 dark:border-gray-800 dark:bg-gray-900">
          <View className="flex-row items-center rounded-lg bg-gray-100 px-2 dark:bg-gray-800">
            <Ionicons name="search-outline" size={15} color="#9ca3af" />
            <TextInput
              className="flex-1 px-2 py-2 text-sm text-gray-900 dark:text-gray-100"
              value={filter}
              onChangeText={setFilter}
              placeholder={t('favorites.searchPlaceholder')}
              placeholderTextColor="#9ca3af"
              returnKeyType="search"
            />
            {filter.length > 0 ? (
              <Pressable onPress={() => setFilter('')} hitSlop={8} className="px-1">
                <Ionicons name="close-circle" size={16} color="#9ca3af" />
              </Pressable>
            ) : null}
          </View>
        </View>

        <FlatList
          data={display}
          keyExtractor={(item) => String(item.id)}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={areaHeader}
          ListEmptyComponent={
            <View className="px-4 py-16">
              <Text className="text-center text-sm text-gray-500 dark:text-gray-400">
                {items.length === 0 ? t('favorites.empty') : t('favorites.noMatch')}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            // Delete sits last per SwipeRowActions' documented convention, and
            // swiping is disabled in select mode so a gesture cannot delete a
            // row the user is only ticking.
            <SwipeRowActions
              disabled={selectMode}
              actions={[
                {
                  label: t('common.delete'),
                  icon: 'trash-outline',
                  color: 'red',
                  onPress: () => removeHere(item),
                },
              ]}
            >
            <Pressable
              onPress={() => (selectMode ? togglePick(item.id) : openDetail(item.taxon_id))}
              onLongPress={() => (selectMode ? undefined : handleLongPress(item))}
              className="flex-row items-center border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-3 active:bg-gray-50 dark:active:bg-gray-800"
            >
              {selectMode ? (
                <Ionicons
                  name={picked.has(item.id) ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={picked.has(item.id) ? '#2563eb' : '#9ca3af'}
                  style={{ marginRight: 12 }}
                />
              ) : null}
              <View className="flex-1">
              {item.common_name_c ? (
                <Text className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {item.common_name_c}
                </Text>
              ) : null}
              <ScientificName
                name={item.simple_name}
                author=""
                kingdom={item.kingdom}
                className="text-xs text-gray-700 dark:text-gray-300"
              />
              {item.family_c || item.family ? (
                <Text className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                  {item.family_c}
                  {item.family ? ` ${item.family}` : ''}
                </Text>
              ) : null}
              </View>
            </Pressable>
            </SwipeRowActions>
          )}
        />
      </View>

      {/* 底部貼鍵盤的 fuzzy 搜尋框：加入到「目前這個目錄」 */}
      <KeyboardStickyView offset={{ opened: insets.bottom }}>
        <SearchBox
          onSelect={(r) => {
            add(r, folderId);
            toast(t('favorites.addedNamed', { name: r.cname || r.name }));
          }}
          onLongPressResult={async (r) => {
            Keyboard.dismiss();
            if (Platform.OS === 'ios') await new Promise((res) => setTimeout(res, 150));
            setSelected(r);
          }}
        />
      </KeyboardStickyView>

      <LookupResultSheet
        result={selected}
        onClose={() => setSelected(null)}
        onAddToSession={() => {
          if (selected) addSpecies(selected);
        }}
        addButtonLabel={t('favorites.addToRecord')}
        onAddLongPress={async () => {
          if (!selected) return;
          if (await promptAddDestination(selected)) setSelected(null);
        }}
      />
      <RecordPickerSheet
        visible={pickerRecords !== null}
        records={pickerRecords ?? []}
        onCancel={() => setPickerRecords(null)}
        onConfirm={handlePickerConfirm}
      />

      <BatchImportModal
        visible={batchOpen}
        target={{ kind: 'favorites', folderId }}
        onClose={() => setBatchOpen(false)}
        onCommitted={(added) => {
          // BatchImportModal writes straight to the DB (shared with the session
          // path), so the store must be told to re-read.
          refreshFavorites();
          if (added > 0) toast(t('favorites.importedCount', { count: added }));
        }}
      />
      {addRecordModal}
    </SafeAreaView>
  );
}
