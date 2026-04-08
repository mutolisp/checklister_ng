export interface ChecklistInput {
  name: string;
  species: any[];
}

export interface ComparisonResult {
  /** 各名錄物種 Set (by scientific name) */
  sets: Map<string, Set<string>>;
  /** 所有名錄共同種 */
  shared: string[];
  /** 各名錄獨有種 */
  unique: Map<string, string[]>;
  /** 所有出現過的物種及其出現名錄 */
  matrix: { name: string; cname: string; lists: boolean[] }[];
}

/**
 * 比較多個名錄
 */
export function compareChecklists(inputs: ChecklistInput[]): ComparisonResult {
  const sets = new Map<string, Set<string>>();
  const speciesInfo = new Map<string, string>(); // name → cname

  for (const input of inputs) {
    const nameSet = new Set<string>();
    for (const sp of input.species) {
      const sciName = sp.name || sp.scientificName || "";
      if (sciName) {
        nameSet.add(sciName);
        if (!speciesInfo.has(sciName)) {
          speciesInfo.set(sciName, sp.cname || sp.vernacularName || "");
        }
      }
    }
    sets.set(input.name, nameSet);
  }

  const allNames = Array.from(sets.values());

  // 共同種：所有名錄都有
  const shared = allNames.length > 0
    ? [...allNames[0]].filter(sp => allNames.every(s => s.has(sp)))
    : [];

  // 各名錄獨有種
  const unique = new Map<string, string[]>();
  for (const [listName, listSet] of sets) {
    const others = [...sets.entries()].filter(([n]) => n !== listName).map(([, s]) => s);
    const uniq = [...listSet].filter(sp => others.every(s => !s.has(sp)));
    unique.set(listName, uniq);
  }

  // 物種矩陣
  const allSpecies = new Set<string>();
  for (const s of sets.values()) {
    for (const sp of s) allSpecies.add(sp);
  }

  const listNames = inputs.map(i => i.name);
  const matrix = [...allSpecies].sort().map(sp => ({
    name: sp,
    cname: speciesInfo.get(sp) || "",
    lists: listNames.map(ln => sets.get(ln)?.has(sp) || false),
  }));

  return { sets, shared, unique, matrix };
}

/**
 * Sørensen similarity: 2C / (A + B)
 */
export function sorensen(a: Set<string>, b: Set<string>): number {
  const common = [...a].filter(x => b.has(x)).length;
  const total = a.size + b.size;
  return total === 0 ? 0 : (2 * common) / total;
}

/**
 * Jaccard similarity: C / (A + B - C)
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  const common = [...a].filter(x => b.has(x)).length;
  const union = a.size + b.size - common;
  return union === 0 ? 0 : common / union;
}

/**
 * Shannon-Wiener H': -Σ(pi × ln(pi))
 * @param abundances array of abundance values (> 0)
 */
export function shannonWiener(abundances: number[]): number {
  const valid = abundances.filter(n => n > 0);
  if (valid.length === 0) return 0;
  const total = valid.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const n of valid) {
    const p = n / total;
    if (p > 0) h -= p * Math.log(p);
  }
  return h;
}

/**
 * Simpson D: 1 - Σ(pi²)
 */
export function simpson(abundances: number[]): number {
  const valid = abundances.filter(n => n > 0);
  if (valid.length === 0) return 0;
  const total = valid.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let d = 0;
  for (const n of valid) {
    const p = n / total;
    d += p * p;
  }
  return 1 - d;
}

/**
 * Evenness J': H' / ln(S)
 */
export function evenness(h: number, speciesCount: number): number {
  if (speciesCount <= 1) return 0;
  return h / Math.log(speciesCount);
}

/**
 * 從名錄取得 abundance 陣列
 */
export function getAbundances(species: any[]): number[] {
  return species.map(sp => sp.abundance || sp.individualCount || 0);
}

/**
 * 檢查名錄是否有豐度資料
 */
export function hasAbundanceData(species: any[]): boolean {
  return species.some(sp => (sp.abundance || sp.individualCount || 0) > 0);
}
