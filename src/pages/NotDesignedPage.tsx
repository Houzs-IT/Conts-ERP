import { useSession } from '../lib/session';
import { HOME } from '../lib/navigation';

/** Any address the app has no screen for (a mistyped or old link): say so plainly and offer the way home,
 *  never a dead end. */
export default function NotDesignedPage() {
  const { user } = useSession();
  const home = user ? HOME[user.role] : '/';
  return (
    <div className="max-w-[460px] bg-card border border-solid border-line rounded-card p-7 flex flex-col gap-[11px]">
      <div className="text-[16px] font-semibold">This page does not exist</div>
      <div className="text-[13px] text-muted-ink">The link may be mistyped, or the screen has moved. Use the menu, or go back to your home screen.</div>
      <a href={`#${home}`} className="self-start mt-1 h-9 flex items-center px-[14px] py-0 rounded-control bg-black text-white! text-[13px] font-medium no-underline">
        Go to home screen
      </a>
    </div>
  );
}
