import type { AccessCategory, AccessLevel, AccessSetting } from './types';

export const TIER_LEVELS = ['view', 'edit', 'full'] as const;
export type TierLevel = (typeof TIER_LEVELS)[number];
export type TierState = 'on' | 'off' | 'mixed';
export type RuleMap = Record<string, AccessSetting>;
export type RoleLevels = Record<string, AccessLevel>;

export interface RoleGrants { granted: number; full: number; available: number }
export interface RuleToWrite { key: string; level: AccessLevel }

const RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2, full: 3 };
const LEVEL_BY_RANK: AccessLevel[] = ['none', 'view', 'edit', 'full'];

const groupRuleKey = (group: string): string => `group:${group}`;

const storedLevel = (rules: RuleMap, key: string): AccessLevel | undefined => {
  const setting = rules[key];
  return setting && setting !== 'inherit' ? setting : undefined;
};

export const areaKeysOf = (categories: AccessCategory[]): string[] => categories.flatMap(category => category.areas.map(area => area.key));

export function resolveRoleLevels(categories: AccessCategory[], departmentRules: RuleMap, positionRules: RuleMap = {}): RoleLevels {
  const levels: RoleLevels = {};
  for (const category of categories) {
    const group = groupRuleKey(category.group);
    for (const area of category.areas) {
      levels[area.key] = storedLevel(positionRules, area.key)
        ?? storedLevel(departmentRules, area.key)
        ?? storedLevel(positionRules, group)
        ?? storedLevel(departmentRules, group)
        ?? 'none';
    }
  }
  return levels;
}

export function rulesToWrite(categories: AccessCategory[], storedRules: RuleMap, desired: RoleLevels): RuleToWrite[] {
  return areaKeysOf(categories)
    .filter(key => storedLevel(storedRules, key) !== desired[key])
    .map(key => ({ key, level: desired[key] }));
}

export function tierState(levels: RoleLevels, areaKeys: string[], tier: TierLevel): TierState {
  const reaching = areaKeys.filter(key => RANK[levels[key]] >= RANK[tier]).length;
  if (reaching === 0) return 'off';
  return reaching === areaKeys.length ? 'on' : 'mixed';
}

export function raiseTo(levels: RoleLevels, areaKeys: string[], tier: TierLevel): RoleLevels {
  const next = { ...levels };
  for (const key of areaKeys) next[key] = LEVEL_BY_RANK[Math.max(RANK[levels[key]], RANK[tier])];
  return next;
}

export function lowerBelow(levels: RoleLevels, areaKeys: string[], tier: TierLevel): RoleLevels {
  const next = { ...levels };
  for (const key of areaKeys) next[key] = LEVEL_BY_RANK[Math.min(RANK[levels[key]], RANK[tier] - 1)];
  return next;
}

export function countGrants(levels: RoleLevels, areaKeys: string[]): RoleGrants {
  return {
    granted: areaKeys.filter(key => RANK[levels[key]] > 0).length,
    full: areaKeys.filter(key => levels[key] === 'full').length,
    available: areaKeys.length,
  };
}

export function countChanged(saved: RoleLevels, draft: RoleLevels, areaKeys: string[]): number {
  return areaKeys.filter(key => saved[key] !== draft[key]).length;
}
