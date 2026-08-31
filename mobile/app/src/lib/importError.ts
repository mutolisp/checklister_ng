/**
 * Record-import failures, as codes rather than messages.
 *
 * The parsers are pure (no `~/i18n` import) so they can run outside the app —
 * localisation happens at the UI edge, in `recordCreate.ts`, which maps each
 * code to an i18n key.
 */
export type ImportErrorCode =
  /** zip contained no .yml/.yaml entry */
  | 'noYmlInZip'
  /** yml parsed but is not a record document */
  | 'invalidYml'
  /** record document is missing its identity fields */
  | 'missingFields'
  /** a 採集 (collection) export — no import support yet */
  | 'unsupportedCollection'
  /** a multi-record `bundleMany` zip — ambiguous, refuse rather than guess */
  | 'unsupportedBundle'
  /** neither a plot nor a session document */
  | 'unknownKind';

export class ImportError extends Error {
  // A plain field, not a `readonly` constructor parameter: the import parsers
  // are also loaded by `npm run check:roundtrip`, and Node's type stripping
  // rejects parameter properties (they emit code, not just types).
  code: ImportErrorCode;

  constructor(code: ImportErrorCode) {
    super(code);
    this.name = 'ImportError';
    this.code = code;
  }
}
