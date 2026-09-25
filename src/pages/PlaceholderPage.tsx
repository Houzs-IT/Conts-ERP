import PageHeader from '../components/PageHeader';
import { Card } from '../components/Card';

/** Placeholder for SCM nav items that are in the target nav (owner's screenshots) but whose
 *  page is not built yet — so the arrangement matches and nothing 404s. Being replaced module
 *  by module as each screen is built out to match Houzs. */
export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} sub="This screen is being built" />
      <Card>
        <div className="py-[48px] px-[22px] text-center flex flex-col gap-2 items-center">
          <span className="text-[15px] font-semibold">{title} — coming soon</span>
          <span className="text-[13px] text-muted-ink max-w-[420px]">This module is on the plan and its place in the navigation is set. The screen itself is being built out to match the Houzs layout and flow.</span>
        </div>
      </Card>
    </>
  );
}
