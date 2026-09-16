/**
 * Darwin Core Archive with Event core + Occurrence extension + Humboldt
 * (eco:Event) extension — the GBIF-recommended packaging for survey data
 * (GBIF "Guide for publishing biological survey and monitoring data",
 * DOI 10.35035/doc-ynvs-eh84: Event core, nested eventID/parentEventID,
 * TAB-delimited text + meta.xml + eml.xml in a zip).
 *
 * Extension row type / term namespace verified against the live GBIF registry
 * extension (humboldt_2025-07-10.xml): rowType http://rs.tdwg.org/eco/terms/Event,
 * namespace http://rs.tdwg.org/eco/terms/. Every eco term used below appears
 * in that file's property list.
 *
 * meta.xml field indices and the txt column order are generated from the SAME
 * column spec arrays, so they cannot drift apart.
 *
 * Pure module (fflate only) — Node-runnable for scripts/check-vegmatrix.mjs.
 */
import { strToU8, zipSync } from 'fflate';

const DWC = 'http://rs.tdwg.org/dwc/terms/';
const ECO = 'http://rs.tdwg.org/eco/terms/';

type ColSpec = { key: string; term: string };

/** Event core columns. Index 0 doubles as the core <id>. */
export const EVENT_COLS: ColSpec[] = [
  { key: 'eventID', term: `${DWC}eventID` },
  { key: 'parentEventID', term: `${DWC}parentEventID` },
  { key: 'eventDate', term: `${DWC}eventDate` },
  { key: 'samplingProtocol', term: `${DWC}samplingProtocol` },
  { key: 'sampleSizeValue', term: `${DWC}sampleSizeValue` },
  { key: 'sampleSizeUnit', term: `${DWC}sampleSizeUnit` },
  { key: 'locality', term: `${DWC}locality` },
  { key: 'decimalLatitude', term: `${DWC}decimalLatitude` },
  { key: 'decimalLongitude', term: `${DWC}decimalLongitude` },
  { key: 'coordinateUncertaintyInMeters', term: `${DWC}coordinateUncertaintyInMeters` },
  { key: 'minimumElevationInMeters', term: `${DWC}minimumElevationInMeters` },
  { key: 'recordedBy', term: `${DWC}recordedBy` },
  { key: 'eventRemarks', term: `${DWC}eventRemarks` },
];

export const OCCURRENCE_COLS: ColSpec[] = [
  { key: 'occurrenceID', term: `${DWC}occurrenceID` },
  { key: 'basisOfRecord', term: `${DWC}basisOfRecord` },
  { key: 'taxonID', term: `${DWC}taxonID` },
  { key: 'scientificName', term: `${DWC}scientificName` },
  { key: 'scientificNameAuthorship', term: `${DWC}scientificNameAuthorship` },
  { key: 'vernacularName', term: `${DWC}vernacularName` },
  { key: 'family', term: `${DWC}family` },
  { key: 'kingdom', term: `${DWC}kingdom` },
  { key: 'organismQuantity', term: `${DWC}organismQuantity` },
  { key: 'organismQuantityType', term: `${DWC}organismQuantityType` },
  { key: 'sex', term: `${DWC}sex` },
  { key: 'lifeStage', term: `${DWC}lifeStage` },
  { key: 'reproductiveCondition', term: `${DWC}reproductiveCondition` },
  { key: 'degreeOfEstablishment', term: `${DWC}degreeOfEstablishment` },
  { key: 'eventDate', term: `${DWC}eventDate` },
  { key: 'decimalLatitude', term: `${DWC}decimalLatitude` },
  { key: 'decimalLongitude', term: `${DWC}decimalLongitude` },
  { key: 'coordinateUncertaintyInMeters', term: `${DWC}coordinateUncertaintyInMeters` },
  { key: 'occurrenceRemarks', term: `${DWC}occurrenceRemarks` },
];

export const HUMBOLDT_COLS: ColSpec[] = [
  { key: 'siteCount', term: `${ECO}siteCount` },
  { key: 'siteNestingDescription', term: `${ECO}siteNestingDescription` },
  { key: 'totalAreaSampledValue', term: `${ECO}totalAreaSampledValue` },
  { key: 'totalAreaSampledUnit', term: `${ECO}totalAreaSampledUnit` },
  { key: 'eventDurationValue', term: `${ECO}eventDurationValue` },
  { key: 'eventDurationUnit', term: `${ECO}eventDurationUnit` },
  { key: 'protocolNames', term: `${ECO}protocolNames` },
  { key: 'samplingPerformedBy', term: `${ECO}samplingPerformedBy` },
  { key: 'isAbundanceReported', term: `${ECO}isAbundanceReported` },
  { key: 'isVegetationCoverReported', term: `${ECO}isVegetationCoverReported` },
  { key: 'isAbsenceReported', term: `${ECO}isAbsenceReported` },
];

/** A data row: values keyed by ColSpec key. Missing keys become empty cells.
 *  Extension rows additionally carry `coreEventID` (the coreid). */
export type DwcRow = Record<string, string | number | boolean | null | undefined>;

function cell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  // TAB-delimited with no field enclosure: strip the delimiters from values.
  return String(v).replace(/[\t\r\n]+/g, ' ');
}

function txtFile(cols: ColSpec[], rows: DwcRow[], withCoreId: boolean): string {
  const header = [...(withCoreId ? ['coreEventID'] : []), ...cols.map((c) => c.key)];
  const lines = [header.join('\t')];
  for (const r of rows) {
    const cells = [
      ...(withCoreId ? [cell(r.coreEventID)] : []),
      ...cols.map((c) => cell(r[c.key])),
    ];
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fieldTags(cols: ColSpec[], startIndex: number): string {
  return cols
    .map((c, i) => `    <field index="${startIndex + i}" term="${c.term}"/>`)
    .join('\n');
}

function buildMetaXml(): string {
  // Core: id at index 0 = eventID (also declared as a field so consumers see
  // the term). Extensions: coreid at index 0, fields from index 1.
  return `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/" metadata="eml.xml">
  <core encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n" fieldsEnclosedBy="" ignoreHeaderLines="1" rowType="http://rs.tdwg.org/dwc/terms/Event">
    <files><location>event.txt</location></files>
    <id index="0"/>
${fieldTags(EVENT_COLS, 0)}
  </core>
  <extension encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n" fieldsEnclosedBy="" ignoreHeaderLines="1" rowType="http://rs.tdwg.org/dwc/terms/Occurrence">
    <files><location>occurrence.txt</location></files>
    <coreid index="0"/>
${fieldTags(OCCURRENCE_COLS, 1)}
  </extension>
  <extension encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n" fieldsEnclosedBy="" ignoreHeaderLines="1" rowType="http://rs.tdwg.org/eco/terms/Event">
    <files><location>humboldt.txt</location></files>
    <coreid index="0"/>
${fieldTags(HUMBOLDT_COLS, 1)}
  </extension>
</archive>`;
}

export type DwcArchiveMeta = {
  /** Dataset title (project name). */
  title: string;
  abstract: string;
  /** Creator / contact person (project surveyors or empty). */
  creator: string;
  /** ISO date of packaging. */
  pubDate: string;
  packageId: string;
};

function buildEmlXml(meta: DwcArchiveMeta): string {
  const person = meta.creator
    ? `<individualName><surName>${xmlEscape(meta.creator)}</surName></individualName>`
    : `<organizationName>Checklister-NG</organizationName>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="eml://ecoinformatics.org/eml-2.1.1"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         packageId="${xmlEscape(meta.packageId)}" system="checklister-ng" scope="system"
         xml:lang="zh-TW">
  <dataset>
    <title>${xmlEscape(meta.title)}</title>
    <creator>${person}</creator>
    <pubDate>${xmlEscape(meta.pubDate)}</pubDate>
    <language>zh-TW</language>
    <abstract><para>${xmlEscape(meta.abstract || meta.title)}</para></abstract>
    <contact>${person}</contact>
  </dataset>
</eml:eml>`;
}

export type DwcArchiveInput = {
  meta: DwcArchiveMeta;
  events: DwcRow[];
  occurrences: DwcRow[];
  humboldt: DwcRow[];
};

/** Assemble the archive zip bytes (event.txt + occurrence.txt + humboldt.txt
 *  + meta.xml + eml.xml). The caller stores these bytes into the outer bundle
 *  with { level: 0 } — no point re-deflating a deflate stream. */
export function buildDwcArchive(input: DwcArchiveInput): Uint8Array {
  return zipSync(
    {
      'meta.xml': strToU8(buildMetaXml()),
      'eml.xml': strToU8(buildEmlXml(input.meta)),
      'event.txt': strToU8(txtFile(EVENT_COLS, input.events, false)),
      'occurrence.txt': strToU8(txtFile(OCCURRENCE_COLS, input.occurrences, true)),
      'humboldt.txt': strToU8(txtFile(HUMBOLDT_COLS, input.humboldt, true)),
    },
    { level: 6 },
  );
}

/** Exposed for the check script: header of each txt vs meta.xml field order. */
export const DWCA_INTERNALS = { buildMetaXml, txtFile };
