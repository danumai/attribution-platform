import { TicketMark } from '@/lib/mark';
import { pillNeutral } from '@/lib/tw';

export function PublisherBrand() {
  return (
    <div className="mb-6 flex items-center gap-2.25 [&_svg]:size-6 [&_svg]:shrink-0 [&_svg]:fill-ink">
      <TicketMark />
      <b className="text-sm font-[650] tracking-[-0.015em]">BanglaReels</b>
      <span className={pillNeutral}>demo publisher</span>
    </div>
  );
}
