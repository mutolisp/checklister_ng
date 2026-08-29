declare module 'piexifjs' {
  export const ImageIFD: Record<string, number>;
  export const ExifIFD: Record<string, number>;
  export const GPSIFD: Record<string, number>;
  export const InteropIFD: Record<string, number>;
  export const TagValues: Record<string, Record<string, number>>;
  /** ifd name ('Image' | '0th' | '1st' | 'Exif' | 'GPS' | 'Interop') → tag number → descriptor. */
  export const TAGS: Record<string, Record<number, { name: string; type: string }>>;
  export const Version: string;

  export type ExifDict = {
    '0th'?: Record<number, unknown>;
    Exif?: Record<number, unknown>;
    GPS?: Record<number, unknown>;
    Interop?: Record<number, unknown>;
    '1st'?: Record<number, unknown>;
    thumbnail?: string | null;
  };

  export function load(data: string): ExifDict;
  export function dump(dict: ExifDict): string;
  export function insert(exifStr: string, jpegData: string): string;
  export function remove(jpegData: string): string;

  export const GPSHelper: {
    degToDmsRational: (deg: number) => [[number, number], [number, number], [number, number]];
    dmsRationalToDeg: (dms: [number, number][], ref: string) => number;
  };
}
