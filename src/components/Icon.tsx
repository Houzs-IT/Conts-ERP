import { type ComponentType, type CSSProperties } from 'react';
// Only the icons the source names (scripts/build/usedIcons.mjs), not the whole library.
import icons from 'virtual:used-icons';
import { iconSize, iconStroke } from '../theme';

type Size = keyof typeof iconSize;

/** One outline family across all three ERPs: lucide-react at stroke 1.75.
 *  Pass the PascalCase lucide name, e.g. <Icon name="LayoutDashboard" />. */
export default function Icon({
  name, size = 'base', color = 'currentColor', style,
}: { name: string; size?: Size; color?: string; style?: CSSProperties }) {
  const C = (icons as Record<string, ComponentType<any>>)[name];
  if (!C) { if (import.meta.env.DEV) console.warn(`Icon "${name}" is not a lucide icon named anywhere in src`); return null; }
  return <C size={iconSize[size]} strokeWidth={iconStroke} color={color} style={{ flex: 'none', ...style }} />;
}

/** kebab-case (as stored in navigation.ts and tokens.json) → PascalCase. */
export function toPascal(kebab: string) {
  return kebab.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('');
}
