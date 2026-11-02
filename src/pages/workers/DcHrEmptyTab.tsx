import { EmptyState } from '../../components/States';

/* ------------------------------------------------------------------ *
 * Dream Crafter > HR > Employees > Attendance and Punch Sites: the Dream
 * Crafter version of The Conts' punch in / punch out (HR > Employees >
 * Hours, #426). Dream Crafter staff cannot clock in yet, so both tabs say
 * what will show here and stay empty until they can.
 * ------------------------------------------------------------------ */

const PAGES = {
  attendance: {
    icon: 'UserCheck',
    empty: 'Dream Crafter clock-in is not set up yet',
    body: 'Dream Crafter staff are added on Staff > Employee Master. Once they can clock in, everyone shows here each day: clock-in and clock-out, the selfie, whether they were at a Dream Crafter site, and anyone not in or on leave. A punch left open more than 16 hours shows as no clock-out for the office to fix, and the office can key a day for someone who forgot to clock in.',
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
