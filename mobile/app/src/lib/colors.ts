/**
 * App accent, in one place.
 *
 * `#00A2A5` arrived for the 匯出 swipe action and then spread to the header
 * icon buttons and the filled primary actions. It was redefined at each of
 * those sites, which is how a palette drifts — so it lives here now.
 *
 * `ACTION_FILL` is a Tailwind class string rather than a hex because the
 * buttons it styles differ in shape and padding; only the fill and its pressed
 * state are shared. NativeWind's scanner reads it as a literal from this file
 * (the same mechanism that makes `SwipeRowActions`' colour map work), so the
 * arbitrary values are compiled even though call sites interpolate it.
 */

/** Accent, for glyphs and text. */
export const ACCENT = '#00A2A5';
/** Accent at ~0.8 luminance, for a pressed fill. */
export const ACCENT_PRESSED = '#008284';

/** Filled primary action: the button that completes what the user started. */
export const ACTION_FILL = 'bg-[#00A2A5] active:bg-[#008284]';
