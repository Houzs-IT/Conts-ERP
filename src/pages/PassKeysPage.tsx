import PageHeader from '../components/PageHeader';
import AccessTab from './units/AccessTab';

export default function PassKeysPage() {
  return (
    <>
      <PageHeader title="Pass key" sub="Every unit's keys, PINs and cards. Codes are masked, and revealing one is recorded in History." />
      <AccessTab />
    </>
  );
}
