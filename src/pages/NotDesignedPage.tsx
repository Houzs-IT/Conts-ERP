/** Undesigned destinations state the reason and offer the next action — they are
 *  never dead links. See copy.md section 12. */
export default function NotDesignedPage() {
  return (
    <div className="max-w-[460px] bg-card border border-solid border-line rounded-card p-7 flex flex-col gap-[11px]">
      <div className="text-[16px] font-semibold">Not designed yet</div>
      <div className="text-[13px] text-muted-ink">This module is specified in BUTTONS.md and api.md but has no screen yet.</div>
      <a href="#/" className="self-start mt-1 h-9 flex items-center px-[14px] py-0 rounded-control bg-black text-white! text-[13px] font-medium no-underline">
        Dashboard
      </a>
    </div>
  );
}
