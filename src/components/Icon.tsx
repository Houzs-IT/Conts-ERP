import { type ComponentType, type CSSProperties } from 'react';
import * as Lucide from 'lucide-react';
import { iconSize, iconStroke } from '../theme';

type Size = keyof typeof iconSize;

/** One outline family across all three ERPs: lucide-react at stroke 1.75.
 *  Pass the PascalCase lucide name, e.g. <Icon name="LayoutDashboard" />. */
export default function Icon({
  name, size = 'base', color = 'currentColor', style,
}: { name: string; size?: Size; color?: string; style?: CSSProperties }) {
  const C = (Lucide as unknown as Record<string, ComponentType<any>>)[name];
  if (!C) return null;
  return <C size={iconSize[size]} strokeWidth={iconStroke} color={color} style={{ flex: 'none', ...style }} />;
}

/** kebab-case (as stored in navigation.ts and tokens.json) → PascalCase. */
export function toPascal(kebab: string) {
  return kebab.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('');
}
