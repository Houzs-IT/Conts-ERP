import { EmptyState } from '../../components/States';

/* ------------------------------------------------------------------ *
 * Dream Crafter > HR > Employees > Punch Sites: the Dream Crafter version of
 * The Conts' punch sites (HR > Employees > Hours, #426). Dream Crafter has
 * no sites yet, so the tab says what will show here and stays empty until it
 * has. Attendance has its own tab (DcAttendanceTab).
 * ------------------------------------------------------------------ */

const PAGES = {
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
