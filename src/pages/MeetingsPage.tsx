import PageHeader from '../components/PageHeader';
import { Meetings } from './meetings';

/** System > Meetings (and the same screen under the supply chain's System, so that sidebar stays put): the meeting
 *  rooms The Conts shares with Houzs and Hookka, kept in the Houzs IT Hub (functions/_lib/meetingsHub.ts). The page
 *  fills the screen below its header, so the calendar scrolls inside itself like Google Calendar. */
export default function MeetingsPage() {
  return (
    <div className="flex flex-col min-h-0 gap-3" style={{ height: 'calc(100dvh - 140px)', minHeight: 560 }}>
      <PageHeader title="Meetings" sub="Meeting rooms shared by every company. Book anyone from any company; they see it in their own ERP." />
      <div className="meetings-ui bg-meet-canvas flex-1 min-h-0 -mx-4 sm:mx-0 sm:rounded-card sm:border sm:border-solid border-line overflow-hidden">
        <Meetings erpName="Theconts ERP" embedded />
      </div>
    </div>
  );
}
