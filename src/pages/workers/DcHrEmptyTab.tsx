import { EmptyState } from '../../components/States';

/* ------------------------------------------------------------------ *
 * Dream Crafter > HR > Employees > Attendance and Punch Sites: the Dream
 * Crafter version of The Conts' punch in / punch out (HR > Employees >
 * Hours, #426). Dream Crafter has no employees or sites in HR yet, so
 * both tabs say what will show here and stay empty until they do.
 * ------------------------------------------------------------------ */

const PAGES = {
  attendance: {
    icon: 'UserCheck',
    empty: 'No Dream Crafter employees yet',
    body: 'Once Dream Crafter staff are added to HR, everyone shows here each day: clock-in and clock-out, the selfie, whether they were at a Dream Crafter site, and anyone not in or on leave. A punch left open more than 16 hours shows as no clock-out for the office to fix, and the office can key a day for someone who forgot to clock in.',
  },
  'punch-sites': {
    icon: 'MapPin',
    empty: 'No Dream Crafter sites yet',
    body: 'Dream Crafter sites, such as the showroom and the warehouse, will be listed here with their map location and a punch radius (200 m unless changed). A punch inside the radius reads "At" the site. A punch is never refused for being off site.',
  },
} as const;
export type DcHrEmptyTabKey = keyof typeof PAGES;

export default function DcHrEmptyTab({ page }: { page: DcHrEmptyTabKey }) {
  const { icon, empty, body } = PAGES[page];
  return <EmptyState icon={icon} title={empty} body={body} />;
}
