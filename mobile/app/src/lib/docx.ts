/**
 * Minimal Markdown → DOCX (OOXML) renderer, hand-built with fflate.
 *
 * A .docx is a ZIP of XML parts. We emit the three parts a valid word document
 * needs ([Content_Types].xml, _rels/.rels, word/document.xml) and skip
 * styles.xml — headings use direct formatting (bold + font size) instead of
 * named styles, which Word/Pages/Google Docs all open fine.
 *
 * `buildDocx` and the run helpers are shared with the herbarium label sheet
 * (`docxLabels.ts`). Because there is no `word/_rels/document.xml.rels`, no
 * caller may emit anything carrying an `r:id` (image, hyperlink, header) —
 * adding one means adding a part here AND an entry in `[Content_Types].xml`.
 *
 * This intentionally parses only the Markdown subset that `generateMarkdown`
 * (src/lib/markdown.ts) emits:
 *   - `#`..`####` headings
 *   - `**bold**`, `*italic*` inline (a lone `*` — the 歸化 marker — stays literal)
 *   - plain paragraphs, blank lines
 *
 * Chosen over the `docx` npm package because that pulls in Node Buffer/stream
 * shims that are fragile under Hermes; here everything is string → UTF-8 bytes.
 */
import { strToU8, zipSync, type Zippable } from 'fflate';

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type Run = { text: string; bold: boolean; italic: boolean };

/**
 * Split a line into runs, honouring `**bold**` then `*italic*`. Processed
 * left-to-right; the italic alternative requires no inner `*`, so an unpaired
 * `*` (the naturalized-species marker) is left as literal text.
 */
export function parseRuns(text: string, baseBold: boolean): Run[] {
  const runs: Run[] = [];
  const re = /\*\*(.+?)\*\*|\*([^*]+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      runs.push({ text: text.slice(last, m.index), bold: baseBold, italic: false });
    }
    if (m[1] !== undefined) {
      runs.push({ text: m[1], bold: true, italic: false });
    } else {
      runs.push({ text: m[2], bold: baseBold, italic: true });
    }
    last = re.lastIndex;
  }
  if (last < text.length) {
    runs.push({ text: text.slice(last), bold: baseBold, italic: false });
  }
  return runs;
}

// Latin → Times New Roman, CJK → 標楷體. Both set on every run so mixed
// "鷹科 (Accipitridae)" text renders CJK in 標楷體 and Latin in Times within
// the same run (Word picks ascii vs eastAsia per character).
export const RFONTS = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="標楷體"/>';

export function runXml(r: Run, sizeHalfPts: number | null): string {
  const props: string[] = [RFONTS];
  if (r.bold) props.push('<w:b/>');
  if (r.italic) props.push('<w:i/>');
  if (sizeHalfPts) props.push(`<w:sz w:val="${sizeHalfPts}"/><w:szCs w:val="${sizeHalfPts}"/>`);
  return `<w:r><w:rPr>${props.join('')}</w:rPr><w:t xml:space="preserve">${xmlEscape(r.text)}</w:t></w:r>`;
}

// Heading font sizes (half-points): h1=32→16pt, h2=28, h3=26, h4=24.
const HEADING_SIZE: Record<number, number> = { 1: 32, 2: 28, 3: 26, 4: 24 };

// Left indent per hierarchy level (twips); ~1 CJK char ≈ 240.
const INDENT_STEP = 240;

/** Visual hierarchy depth for indentation, inferred from the Markdown line:
 *   ## / ### / #### heading → 0 / 1 / 2 (top group/order flush, sub-ranks deeper)
 *   **N. 科** bold family line → 1
 *   "N. " species line       → 2
 *   title / intro / stats    → 0 */
function indentLevel(line: string): number {
  const h = /^(#{1,4})\s/.exec(line);
  if (h) return Math.max(0, h[1].length - 2);
  if (line.startsWith('**')) return 1;
  if (/^\d+\.\s/.test(line)) return 2;
  return 0;
}

function indXml(line: string): string {
  const lvl = indentLevel(line);
  return lvl > 0 ? `<w:ind w:left="${lvl * INDENT_STEP}"/>` : '';
}

/** Render one Markdown line to an OOXML paragraph, or '' to skip it. Blank
 *  lines are dropped (headings carry their own spacing) so the doc isn't full
 *  of empty paragraphs. */
function paragraphXml(line: string): string {
  if (line.trim() === '') return '';

  const headingMatch = /^(#{1,4})\s+(.*)$/.exec(line);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const size = HEADING_SIZE[level] ?? 24;
    const runs = parseRuns(headingMatch[2], true);
    const body = runs.map((r) => runXml(r, size)).join('');
    return `<w:p><w:pPr><w:spacing w:before="200" w:after="60"/>${indXml(line)}</w:pPr>${body}</w:p>`;
  }

  const runs = parseRuns(line, false);
  const body = runs.map((r) => runXml(r, null)).join('');
  // Compact list lines: no extra space after each species row.
  return `<w:p><w:pPr><w:spacing w:after="0"/>${indXml(line)}</w:pPr>${body}</w:p>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

/**
 * A4 portrait with 2 cm margins, in twips (1/1440 in): 210 x 297 mm.
 *
 * Word's own default is US Letter, which is what an empty `<w:sectPr/>`
 * inherits — wrong for every user of this app. New documents pass this.
 *
 * `CT_SectPr` is a sequence: pgSz → pgMar → cols.
 */
export const A4_SECT_PR =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"' +
  ' w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="425"/></w:sectPr>';

/**
 * Zip the three-part skeleton around a caller-built body.
 *
 * `sectPrXml` must be the LAST child of `<w:body>` — that is a schema
 * requirement, not a convention. The default empty `<w:sectPr/>` inherits
 * Word's own page setup, which is what the Markdown path has always done.
 */
export function buildDocx(bodyXml: string, sectPrXml: string = '<w:sectPr/>'): Uint8Array {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}${sectPrXml}</w:body></w:document>`;

  const zippable: Zippable = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    'word/document.xml': strToU8(documentXml),
  };
  return zipSync(zippable, { level: 6 });
}

/**
 * Render a Markdown string (the subset generateMarkdown emits) to .docx bytes.
 *
 * A4 by DEFAULT rather than per-caller: an empty `<w:sectPr/>` inherits Word's
 * US Letter, which was silently what every checklist export produced. Making it
 * the default means no call site can forget, which a per-caller argument
 * invites — there are four of them.
 */
export function markdownToDocx(md: string, sectPrXml: string = A4_SECT_PR): Uint8Array {
  return buildDocx(md.split(/\r?\n/).map(paragraphXml).join(''), sectPrXml);
}

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
