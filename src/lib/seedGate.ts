/** Decides when an edit form is filled from loaded data (Hookka 96ed60fbd): once per record, not on every answer.
 *  useApi hands a screen the same record several times (the kept copy, then the fresh one, then each timed re-read),
 *  and refilling the form each time threw away what was being typed. `again()` after a save lets the next answer
 *  (the saved record read back) fill it once more. */
export class SeedGate {
  private seededFor: string | null = null;
  /** True when the form should be filled now: data has arrived for a record it has not been filled from yet. */
  due(id: string, hasData: boolean): boolean {
    if (!hasData || this.seededFor === id) return false;
    this.seededFor = id;
    return true;
  }
  /** The next answer fills the form again (after a save, so it shows what the server kept). */
  again(): void { this.seededFor = null; }
}
