/**
 * Registers the resolve hook below for `npm run check:roundtrip`.
 *
 * Node strips TypeScript types on its own, but it will not guess extensions:
 * the app's sources import each other the TS way (`./dwcMapper`), which ESM
 * cannot resolve. The hook appends `.ts` for relative specifiers that have no
 * extension. Nothing else in the repo needs it — Metro does this for the app.
 */
import { register } from 'node:module';
register('./ts-resolve-hooks.mjs', import.meta.url);
