export interface AddTarget {
  id: string;
  username: string;
  filename?: string | null;
  room_title?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  sprite_url?: string | null;
  resolution?: string | null;
  timestamp?: string | null;
}

export interface DialogState {
  open: boolean;
  target: AddTarget | null;
}

let state: DialogState = { open: false, target: null };
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function openAddToCollection(target: AddTarget): void {
  state = { open: true, target };
  emit();
}

export function closeAddToCollection(): void {
  state = { open: false, target: null };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getDialogState(): DialogState {
  return state;
}
