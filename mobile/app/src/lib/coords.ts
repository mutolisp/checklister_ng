/**
 * Parse a coordinate the user typed or pasted.
 *
 * One text field rather than two, because the common case is pasting: from
 * Google Maps ("25.123456, 121.654321"), from a handheld GPS, or off an older
 * datasheet in degrees/minutes/seconds. Two separate boxes would force the user
 * to split that by hand every time.
 *
 * DMS is supported because it is still what GPS units display and what older
 * Taiwanese survey records are written in; refusing it would send someone to a
 * converter website mid-survey, offline.
 *
 * Tokenised rather than matched with one big regex. A single pattern with an
 * optional hemisphere letter at both ends cannot tell the trailing letter of
 * one component from the leading letter of the next: given "N25.1 W121.6" it
 * swallows the W as the first component's trailing letter and the longitude
 * comes back positive — the wrong hemisphere, with no error. That was measured,
 * not imagined.
 */

export type ParsedLatLng =
  | { ok: true; lat: number; lng: number }
  | { ok: false; reason: 'format' | 'range' };

/**
 * A hemisphere letter, or a number with an optional unit mark.
 *
 * Only the symbol marks (° ′ ″) count as units — never the letters d/m/s, which
 * cannot be told apart from the S of "south".
 */
const TOKEN = /([NSEW])|(-?\d+(?:\.\d+)?)\s*(°|'|′|"|″)?/gi;

type Unit = 'deg' | 'min' | 'sec' | null;

type Component = {
  deg: number;
  min: number;
  sec: number;
  hemi: string;
  /** What a following number would be: 'min' after a °, 'sec' after a ′. */
  expects: Unit;
};

/** Full-width punctuation from a Chinese IME, and the various prime marks. */
function normalize(input: string): string {
  return (input ?? '')
    .replace(/[，、]/g, ',')
    .replace(/　/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .trim();
}

function unitOf(mark: string | undefined): Unit {
  if (mark === '°') return 'deg';
  if (mark === "'" || mark === '′') return 'min';
  if (mark === '"' || mark === '″') return 'sec';
  return null;
}

function decimalOf(c: Component): number {
  const magnitude = Math.abs(c.deg) + c.min / 60 + c.sec / 3600;
  const negative = c.deg < 0 || c.hemi === 'S' || c.hemi === 'W';
  return negative ? -magnitude : magnitude;
}

export function parseLatLng(input: string): ParsedLatLng {
  const s = normalize(input);
  if (!s) return { ok: false, reason: 'format' };

  const parts: Component[] = [];
  let cur: Component | null = null;
  const close = () => {
    if (cur) parts.push(cur);
    cur = null;
  };

  for (const m of s.matchAll(TOKEN)) {
    const letter = m[1]?.toUpperCase();
    if (letter) {
      // A letter arriving at a component that already carries one belongs to
      // the NEXT component ("N25.1 W121.6"); otherwise it closes this one
      // ("33.8688S, 151.2093E").
      if (cur && !cur.hemi) {
        cur.hemi = letter;
        close();
      } else {
        close();
        cur = { deg: NaN, min: 0, sec: 0, hemi: letter, expects: null };
      }
      continue;
    }
    if (!m[2]) continue;
    const value = Number(m[2]);
    if (!Number.isFinite(value)) return { ok: false, reason: 'format' };
    const unit = unitOf(m[3]);

    // A number continues the current component ONLY when a unit mark said so.
    // Without marks "25 07" is two coordinates, not 25°07' — guessing DMS there
    // would quietly move the point by kilometres.
    if (cur && Number.isFinite(cur.deg) && cur.expects === 'min') {
      cur.min = value;
      cur.expects = unit === 'min' ? 'sec' : null;
      continue;
    }
    if (cur && Number.isFinite(cur.deg) && cur.expects === 'sec') {
      cur.sec = value;
      cur.expects = null;
      continue;
    }
    if (cur && Number.isFinite(cur.deg)) close();
    if (!cur) cur = { deg: NaN, min: 0, sec: 0, hemi: '', expects: null };
    cur.deg = value;
    cur.expects = unit === 'deg' ? 'min' : unit === 'min' ? 'sec' : null;
  }
  close();

  if (parts.length !== 2) return { ok: false, reason: 'format' };
  if (parts.some((c) => !Number.isFinite(c.deg) || c.min >= 60 || c.sec >= 60)) {
    return { ok: false, reason: 'format' };
  }

  // Hemisphere letters decide which is which, so "E121 N25" works. Without
  // them, fall back to the universal written order: latitude first.
  const axis = (c: Component) =>
    c.hemi === 'N' || c.hemi === 'S' ? 'lat' : c.hemi === 'E' || c.hemi === 'W' ? 'lng' : null;
  const [a, b] = parts;
  const swap = axis(a) === 'lng' || axis(b) === 'lat';
  const lat = decimalOf(swap ? b : a);
  const lng = decimalOf(swap ? a : b);

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, reason: 'range' };
  return { ok: true, lat, lng };
}

/** How a coordinate is shown back to the user for editing. */
export function formatLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}
