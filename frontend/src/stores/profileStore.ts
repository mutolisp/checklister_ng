import { browser } from '$app/environment';

/**
 * Profile store — 偏好設定的 localStorage ↔ DB 同步
 * localStorage 做快取（即時回應），DB 做持久層（可匯出）
 */

// 儲存偏好到 localStorage + DB
export async function setPreference(key: string, value: any) {
  const strValue = typeof value === 'string' ? value : JSON.stringify(value);

  // localStorage（即時）
  if (browser) {
    localStorage.setItem(`pref_${key}`, strValue);
  }

  // DB（背景）
  try {
    await fetch(`/api/profile/preferences/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: strValue }),
    });
  } catch { /* ignore */ }
}

// 讀取偏好（優先 localStorage，fallback DB）
export function getPreference(key: string, defaultValue: string = ''): string {
  if (browser) {
    const stored = localStorage.getItem(`pref_${key}`);
    if (stored !== null) return stored;
  }
  return defaultValue;
}

// 從 DB 同步所有偏好到 localStorage（啟動時呼叫一次）
export async function syncPreferencesFromDB() {
  try {
    const res = await fetch('/api/profile/preferences');
    if (res.ok && browser) {
      const prefs = await res.json();
      for (const [key, value] of Object.entries(prefs)) {
        localStorage.setItem(`pref_${key}`, value as string);
      }
    }
  } catch { /* ignore */ }
}

// 匯出完整 profile
export async function exportProfile(): Promise<any> {
  const res = await fetch('/api/profile/export');
  if (res.ok) return res.json();
  return null;
}

// 匯入 profile
export async function importProfile(data: any): Promise<boolean> {
  const res = await fetch('/api/profile/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.ok;
}
