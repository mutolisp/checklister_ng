/**
 * Ask which 常用名錄 a batch of species should land in.
 *
 * Shared by every entry point that copies species into a folder from outside
 * the favourites screen (which has an implicit target — the folder you are
 * standing in). Mirrors the 新建 / 既有 chooser in `AreaSpeciesModal`.
 */
import { showActionSheet } from '~/components/ActionSheet';
import { promptText } from '~/components/TextPromptModal';
import { useFavorites } from '~/stores/favorites';
import i18n from '~/i18n';

/** Resolved folder id, or null when the user backed out. */
export async function pickFavoriteFolder(defaultName: string): Promise<number | null> {
  const store = useFavorites.getState();
  const folders = store.folders;
  const label = (f: (typeof folders)[number]) =>
    f.is_default ? i18n.t('favorites.defaultFolder') : f.name;

  const idx = await showActionSheet({
    title: i18n.t('records.saveToFavorites'),
    cancelLabel: i18n.t('common.cancel'),
    options: [
      { label: i18n.t('favorites.newFolder') },
      ...folders.map((f) => ({
        label: `${label(f)}（${i18n.t('favorites.count', { count: f.species_count })}）`,
      })),
    ],
  });
  if (idx < 0) return null;
  if (idx > 0) return folders[idx - 1]?.id ?? null;

  // The action sheet is still dismissing; presenting our text-prompt Modal in
  // the same tick is the documented iOS failure (silently no-op, or worse when
  // present and dismiss collide). Unconditional wait — no Platform branch.
  await new Promise((r) => setTimeout(r, 350));
  const name = await promptText({
    title: i18n.t('favorites.newFolder'),
    placeholder: i18n.t('favorites.folderNamePlaceholder'),
    defaultValue: defaultName,
  });
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return store.createFolder(trimmed);
}
