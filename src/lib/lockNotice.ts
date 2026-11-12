import type { Tone } from './types';

/** The toast after a reservation change reaches a month whose income is locked (owner statement close, part 2b): the
 *  server's notice says that the month keeps its locked figures and where the difference goes. */
export const incomeLockedToast = (notice: string) => ({ tone: 'info' as Tone, title: 'Income is locked', body: notice });
