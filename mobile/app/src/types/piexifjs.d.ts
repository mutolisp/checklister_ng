declare module 'piexifjs' {
  export const ImageIFD: Record<string, number>;
  export const ExifIFD: Record<string, number>;
  export const GPSIFD: Record<string, number>;
  export const InteropIFD: Record<string, number>;
  export const TagValues: Record<string, Record<string, number>>;
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
