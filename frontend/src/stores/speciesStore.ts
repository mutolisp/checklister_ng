// frontend/src/stores/speciesStore.ts
import { writable } from 'svelte/store';

export const selectedSpecies = writable<any[]>([]);
