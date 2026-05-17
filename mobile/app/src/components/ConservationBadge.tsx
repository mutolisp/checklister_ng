import { Text, View } from 'react-native';
import { iucnTone } from '~/lib/conservationColors';

type Size = 'sm' | 'md';

type Props = {
  code: string | null | undefined;
  size?: Size;
};

/**
 * IUCN / Taiwan Red List (N-prefixed) coloured chip.
 * Returns null when the code is empty or not in the palette.
 */
export function ConservationBadge({ code, size = 'sm' }: Props) {
  const tone = iucnTone(code);
  if (!tone) return null;

  const padX = size === 'md' ? 8 : 6;
  const padY = size === 'md' ? 3 : 2;
  const fontSize = size === 'md' ? 12 : 11;

  return (
    <View
      style={{
        backgroundColor: tone.bg,
        paddingHorizontal: padX,
        paddingVertical: padY,
        borderRadius: 6,
      }}
    >
      <Text style={{ color: tone.text, fontSize, fontWeight: '600' }}>{tone.label}</Text>
    </View>
  );
}
