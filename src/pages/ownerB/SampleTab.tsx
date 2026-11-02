import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import Icon from '../../components/Icon';

/** Owner portal (sample): the owner portal's own screens filled from Demo mode, for showing a prospective owner.
 *  Until Demo mode ships, the old Owner Showcase presentation opens from here. */
export function SampleTab() {
  const navigate = useNavigate();
  return (
    <section className="bg-card border border-solid border-line rounded-card p-5 sm:p-6 flex flex-col gap-3 max-w-[760px]">
      <span className="text-[16px] font-semibold tracking-[-0.01em]">Owner portal (sample)</span>
      <p className="m-0 text-copy text-muted-ink text-pretty">
        The owner portal a prospective owner is shown, built from the same screens a real owner signs in to, filled with
        sample data from Demo mode. It arrives with Demo mode. Until then, the Owner Showcase presentation is still here.
      </p>
      <Button size="md" variant="secondary" className="self-start" icon={<Icon name="Presentation" size="sm" />}
        onClick={() => navigate('/performance/showcase')}>Open the Owner Showcase</Button>
    </section>
  );
}
