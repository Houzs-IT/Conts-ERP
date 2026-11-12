/** The accounts that sign in with an employee ID and PIN and use the portal (/portal), not the desk: cleaners,
 *  technicians and Renovation staff. Keep in step with FIELD in functions/_lib/auth.ts. */
export const isFieldRole = (role: string | undefined): boolean =>
  role === 'housekeeper' || role === 'technician' || role === 'renovator';
