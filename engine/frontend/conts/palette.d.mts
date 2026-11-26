import type { Plugin as PostcssPlugin, Root, Rule } from 'postcss';
import type { Plugin as VitePlugin } from 'vite';

export declare const PALETTE: Record<string, string>;
export declare const recolourCssValue: (value: string) => string;
export declare const recolourSource: (code: string) => string;
export declare const recolourTheme: (value: unknown) => unknown;
export declare const contsPalettePostcss: { (): PostcssPlugin; postcss: true };
export declare const rewordSource: (code: string) => string;
export declare const contsPaletteVite: () => VitePlugin;

export interface NightLeftLiteral {
  prop: string;
  hex: string;
  reason: string;
}
export declare const pickSelectorsIn: (root: Root) => Set<string>;
export declare const mapRuleForNight: (rule: Rule, picks?: Set<string>) => NightLeftLiteral[];
export declare const isNightMappedFile: (file: string | undefined) => boolean;
export declare const contsNightPostcss: { (): PostcssPlugin; postcss: true };
