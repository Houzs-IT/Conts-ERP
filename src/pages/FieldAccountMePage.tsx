import { PortalLanguageSwitch } from '../components/PortalLanguageSwitch';
import AccountPage from './AccountPage';

export default function FieldAccountMePage() {
  return (
    <div className="flex flex-col gap-4">
      <PortalLanguageSwitch />
      <AccountPage />
    </div>
  );
}
