export interface FilterPreset {
  id: string;
  name: string;
  search: string;
  tags: string[];
  gender: string;
  resolution: string;
  sort: string;
  createdAt: string;
}

const STORAGE_KEY = "vault-filter-presets";

export function getFilterPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveFilterPreset(preset: Omit<FilterPreset, "id" | "createdAt">): FilterPreset {
  const presets = getFilterPresets();
  const newPreset: FilterPreset = {
    ...preset,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  presets.unshift(newPreset);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets.slice(0, 20)));
  return newPreset;
}

export function deleteFilterPreset(id: string) {
  const presets = getFilterPresets().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function updateFilterPreset(id: string, updates: Partial<Omit<FilterPreset, "id" | "createdAt">>) {
  const presets = getFilterPresets().map((p) =>
    p.id === id ? { ...p, ...updates } : p,
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}
