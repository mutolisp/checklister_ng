/**
 * Minimal Markdown → DOCX (OOXML) renderer, hand-built with fflate.
 *
 * A .docx is a ZIP of XML parts. We emit the three parts a valid word document
 * needs ([Content_Types].xml, _rels/.rels, word/document.xml) and skip
 * styles.xml — headings use direct formatting (bold + font size) instead of
 * named styles, which Word/Pages/Google Docs all open fine.
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

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Run = { text: string; bold: boolean; italic: boolean };

/**
 * Split a line into runs, honouring `**bold**` then `*italic*`. Processed
 * left-to-right; the italic alternative requires no inner `*`, so an unpaired
 * `*` (the naturalized-species marker) is left as literal text.
 */
function parseRuns(text: string, baseBold: boolean): Run[] {
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
const RFONTS = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="標楷體"/>';

function runXml(r: Run, sizeHalfPts: number | null): string {
  const props: string[] = [RFONTS];
  if (r.bold) props.push('<w:b/>');
  if (r.italic) props.push('<w:i/>');
  if (sizeHalfPts) props.push(`<w:sz w:val="${sizeHalfPts}"/><w:szCs w:val="${sizeHalfPts}"/>`);
  return `<w:r><w:rPr>${props.join('')}</w:rPr><w:t xml:space="preserve">${xmlEscape(r.text)}</w:t></w:r>`;
}

// Heading font sizes (half-points): h1=32→16pt, h2=28, h3=26, h4=24.
const HEADING_SIZE: Record<number, number> = { 1: 32, 2: 28, 3: 26, 4: 24 };

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
    return `<w:p><w:pPr><w:spacing w:before="200" w:after="60"/></w:pPr>${body}</w:p>`;
  }

  const runs = parseRuns(line, false);
  const body = runs.map((r) => runXml(r, null)).join('');
  // Compact list lines: no extra space after each species row.
  return `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${body}</w:p>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

/** Render a Markdown string (the subset generateMarkdown emits) to .docx bytes. */
export function markdownToDocx(md: string): Uint8Array {
  const paras = md.split(/\r?\n/).map(paragraphXml).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}<w:sectPr/></w:body></w:document>`;

  const zippable: Zippable = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    'word/document.xml': strToU8(documentXml),
  };
  return zipSync(zippable, { level: 6 });
}

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
