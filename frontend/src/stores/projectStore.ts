import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { selectedSpecies, type ChecklistItem } from '$stores/speciesStore';
import { projectMetadata } from '$stores/metadataStore';

export interface ProjectSummary {
  id: number;
  name: string;
  site_name: string;
  species_count: number;
  modified_at: string;
  footprint_wkt: string;
}

// 當前專案 ID（null = 新專案，尚未儲存）
export const currentProjectId = writable<number | null>(null);

// 所有專案列表
export const projectList = writable<ProjectSummary[]>([]);

// 載入專案列表
export async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    if (res.ok) {
      projectList.set(await res.json());
    }
  } catch { /* ignore */ }
}

// 建立新專案（從當前 localStorage 資料）
export async function createProject(): Promise<number | null> {
  const meta = get(projectMetadata);
  const species = get(selectedSpecies);

  try {
    // 建立專案
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: meta.projectName || '未命名專案',
        abstract: meta.projectAbstract || '',
        location_description: meta.locationDescription || '',
        site_name: meta.siteName || '',
        notes: meta.siteNotes || '',
        footprint_wkt: meta.footprintWKT || '',
        geometries_json: JSON.stringify(meta.geometries || {}),
      }),
    });
    if (!res.ok) return null;
    const { id } = await res.json();

    // 批次加入物種
    if (species.length > 0) {
      await fetch(`/api/projects/${id}/species/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          species.map(sp => ({
            taxon_id: sp.taxon_id,
            species_data_json: JSON.stringify(sp),
            abundance: sp.abundance || 0,
          }))
        ),
      });
    }

    currentProjectId.set(id);
    await loadProjects();
    return id;
  } catch {
    return null;
  }
}

// 儲存當前專案（更新）
export async function saveProject() {
  const pid = get(currentProjectId);
  if (!pid) return createProject();

  const meta = get(projectMetadata);
  const species = get(selectedSpecies);

  try {
    // 更新專案 metadata
    await fetch(`/api/projects/${pid}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: meta.projectName || '未命名專案',
        abstract: meta.projectAbstract || '',
        location_description: meta.locationDescription || '',
        site_name: meta.siteName || '',
        notes: meta.siteNotes || '',
        footprint_wkt: meta.footprintWKT || '',
        geometries_json: JSON.stringify(meta.geometries || {}),
      }),
    });

    // 重新同步物種（刪除全部再重新加入）
    // 先取得現有的
    const existingRes = await fetch(`/api/projects/${pid}`);
    if (existingRes.ok) {
      const existing = await existingRes.json();
      const existingTaxonIds = new Set(existing.checklist.map((s: any) => s.taxon_id));
      const currentTaxonIds = new Set(species.map(s => s.taxon_id));

      // 刪除不在當前名錄中的
      for (const tid of existingTaxonIds) {
        if (!currentTaxonIds.has(tid)) {
          await fetch(`/api/projects/${pid}/species/${tid}`, { method: 'DELETE' });
        }
      }

      // 加入新的
      const toAdd = species.filter(sp => !existingTaxonIds.has(sp.taxon_id));
      if (toAdd.length > 0) {
        await fetch(`/api/projects/${pid}/species/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            toAdd.map(sp => ({
              taxon_id: sp.taxon_id,
              species_data_json: JSON.stringify(sp),
              abundance: sp.abundance || 0,
            }))
          ),
        });
      }
    }

    await loadProjects();
    return pid;
  } catch {
    return null;
  }
}

// 載入專案到當前工作區
export async function loadProject(projectId: number) {
  try {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) return false;
    const data = await res.json();

    // 載入 metadata
    const p = data.project;
    projectMetadata.set({
      projectName: p.name || '',
      projectAbstract: p.abstract || '',
      locationDescription: p.location_description || '',
      siteName: p.site_name || '',
      siteNotes: p.notes || '',
      footprintWKT: p.footprint_wkt || '',
      geometries: p.geometries_json ? JSON.parse(p.geometries_json) : { type: 'FeatureCollection', features: [] },
    });

    // 載入物種
    selectedSpecies.set(data.checklist);

    currentProjectId.set(projectId);
    return true;
  } catch {
    return false;
  }
}

// 新建空專案
export function newProject() {
  currentProjectId.set(null);
  selectedSpecies.set([]);
  projectMetadata.set({
    projectName: '',
    projectAbstract: '',
    locationDescription: '',
    siteName: '',
    siteNotes: '',
    footprintWKT: '',
    geometries: { type: 'FeatureCollection', features: [] },
  });
}

// 刪除專案
export async function deleteProject(projectId: number) {
  try {
    await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    if (get(currentProjectId) === projectId) {
      newProject();
    }
    await loadProjects();
  } catch { /* ignore */ }
}
