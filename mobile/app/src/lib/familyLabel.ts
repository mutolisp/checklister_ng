/**
 * `Lauraceae 樟科` — LATIN FIRST.
 *
 * Deliberately inverted from every other list in the app, which leads with the
 * Chinese name (`樟科 Lauraceae` in the favourites list and search results,
 * `樟科 (Lauraceae)` in the specimen detail sheet). A herbarium label and the
 * specimen list that feeds it are read by curators who work from the Latin
 * family, so that is what leads here. Asked for explicitly for this screen.
 */
export function familyLatinFirst(family: string, familyC: string): string {
  const latin = (family ?? '').trim();
  const chinese = (familyC ?? '').trim();
  if (latin && chinese) return `${latin} ${chinese}`;
  return latin || chinese;
}

/**
 * `Moraceae (桑科)` — Latin first, Chinese in parentheses.
 *
 * The label's own form, distinct from `familyLatinFirst`'s space-separated
 * version used in the specimen list: on a label the family shares a line with
 * the vernacular names, so the parentheses are what keep the two apart.
 */
export function familyLatinParen(family: string, familyC: string): string {
  const latin = (family ?? '').trim();
  const chinese = (familyC ?? '').trim();
  if (latin && chinese) return `${latin} (${chinese})`;
  return latin || chinese;
}
