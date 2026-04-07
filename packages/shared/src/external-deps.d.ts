// Ambient module declarations for npm packages that don't ship types.
// arabic-reshaper@1.1.0 and bidi-js@1.0.3 are pure JS.

declare module "arabic-reshaper" {
  interface ArabicReshaper {
    convertArabic(text: string): string;
    convertArabicBack(text: string): string;
  }
  const reshaper: ArabicReshaper;
  export default reshaper;
}

declare module "bidi-js" {
  export interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: Array<{ start: number; end: number; level: number }>;
  }
  export interface BidiApi {
    getEmbeddingLevels(text: string, baseDirection?: "ltr" | "rtl" | "auto"): EmbeddingLevels;
    getReorderedString(text: string, embeddingLevels: EmbeddingLevels): string;
    getReorderedIndices(text: string, embeddingLevels: EmbeddingLevels): number[];
    getReorderSegments(
      text: string,
      embeddingLevels: EmbeddingLevels,
      start?: number,
      end?: number,
    ): Array<[number, number]>;
    getMirroredCharacter(char: string): string | null;
    getMirroredCharactersMap(text: string, embeddingLevels: EmbeddingLevels): Map<number, string>;
  }
  const bidiFactory: () => BidiApi;
  export default bidiFactory;
}
