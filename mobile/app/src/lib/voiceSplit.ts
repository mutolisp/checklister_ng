/**
 * Split a voice-dictated string into individual species-name segments.
 *
 * Field use: the user speaks names into the OS built-in dictation, separating
 * each with 「句號」. iOS / Android dictation insert the *character* 「。」 (not
 * the literal word), so we split on punctuation + whitespace rather than on a
 * spoken keyword. Chinese names contain no internal spaces, so collapsing all
 * separators (CJK + ASCII punctuation, newlines, whitespace) is safe.
 */
export function splitVoiceInput(text: string): string[] {
  return text
    .split(/[。．.，,、；;！!？?\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
