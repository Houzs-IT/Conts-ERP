export type PassKeyStatus = 'new' | 'assigned' | 'needs_support' | 'missed' | 'done';

export interface PassKeyFacts {
  state: string;
  assigneeName: string | null;
  dueOn: string | null;
  supportRequestedAt: string | null;
}

export function passKeyStatus({ state, assigneeName, dueOn, supportRequestedAt }: PassKeyFacts, today: string): PassKeyStatus {
  if (state === 'resolved') return 'done';
  if (supportRequestedAt) return 'needs_support';
  if (dueOn && dueOn < today) return 'missed';
  return assigneeName?.trim() ? 'assigned' : 'new';
}

export type PassKeyDay = 'today' | 'tomorrow';

export function passKeyDay(dueOn: string | null, tomorrow: string): PassKeyDay {
  return dueOn === tomorrow ? 'tomorrow' : 'today';
}
