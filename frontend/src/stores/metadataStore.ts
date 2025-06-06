import { writable } from 'svelte/store';

export const footprintWKT = writable<string | null>(null);

