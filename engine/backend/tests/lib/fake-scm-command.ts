/* runScmPgCommand for route tests over an in-memory fake client: runs the command on the same client and, when it
   answers non-2xx or throws, puts every table back as it was - the transaction's rollback. The fake client must
   expose its tables as `__tables`. Real commit/rollback is proven in tests-pg. */
type Row = Record<string, any>;

export async function fakeRunScmPgCommand(c: any, cmd: (sb: any) => Promise<Response>): Promise<Response> {
  const sb = c.get('supabase');
  const tables = (sb.__tables ?? sb.tables) as Record<string, Row[]> | undefined;
  if (!tables) return cmd(sb);
  const snapshot = JSON.parse(JSON.stringify(tables)) as Record<string, Row[]>;
  const rollback = () => {
    for (const k of Object.keys(tables)) tables[k]!.splice(0, tables[k]!.length, ...(snapshot[k] ?? []));
  };
  try {
    const res = await cmd(sb);
    if (!res.ok) rollback();
    return res;
  } catch {
    rollback();
    return c.json({ error: 'command_failed', message: 'The operation was rolled back. Please try again.' }, 500);
  }
}
