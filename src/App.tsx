import { useEffect, useState, type ComponentType } from 'react';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider } from './components/Toast';
import LoginPage from './pages/LoginPage';
import AppShell from './components/AppShell';
import DashboardPage from './pages/DashboardPage';
import OperationsTodayPage from './pages/OperationsTodayPage';
import CalendarPage from './pages/CalendarPage';
import BookingsPage from './pages/BookingsPage';
import GuestsPage from './pages/GuestsPage';
import PropertiesPage from './pages/PropertiesPage';
import UnitRecordPage from './pages/UnitRecordPage';
import OwnersPage from './pages/OwnersPage';
import StatementsPage from './pages/StatementsPage';
import HousekeepingPage from './pages/HousekeepingPage';
import MaintenancePage from './pages/MaintenancePage';
import TasksPage from './pages/TasksPage';
import InspectionsPage from './pages/InspectionsPage';
import ExpensesPage from './pages/ExpensesPage';
import PayoutsPage from './pages/PayoutsPage';
import ContractsPage from './pages/ContractsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import PricingPage from './pages/PricingPage';
import ReviewsPage from './pages/ReviewsPage';
import InboxPage from './pages/InboxPage';
import AutomationsPage from './pages/AutomationsPage';
import PortfolioPage from './pages/PortfolioPage';
import InventoryPage from './pages/InventoryPage';
import AccessPage from './pages/AccessPage';
import UsersPage from './pages/UsersPage';
import IntegrationsPage from './pages/IntegrationsPage';
import SettingsPage from './pages/SettingsPage';
import NotDesignedPage from './pages/NotDesignedPage';
import FieldTodayPage from './pages/FieldTodayPage';
import FieldShell from './components/FieldShell';
import OwnerShell from './components/OwnerShell';
import OwnerPortalPage from './pages/OwnerPortalPage';
import { HOME } from './lib/navigation';

/** Hash routing keeps this deployable as a static Cloudflare Pages build with no
 *  server rewrites. Swap for react-router if the team prefers path routing. */
function useHashRoute() {
  const [path, setPath] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const onHash = () => setPath(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [path, (p: string) => { window.location.hash = p; }] as const;
}

const ROUTES: Record<string, ComponentType> = {
  '/': DashboardPage,
  '/portfolio': PortfolioPage,

  '/reservations/calendar': CalendarPage,
  '/reservations/bookings': BookingsPage,
  '/reservations/guests': GuestsPage,

  '/operations/today': OperationsTodayPage,
  '/operations/housekeeping': HousekeepingPage,
  '/operations/maintenance': MaintenancePage,
  '/operations/tasks': TasksPage,
  '/operations/inspections': InspectionsPage,

  '/properties': PropertiesPage,
  '/properties/units': PropertiesPage,
  '/properties/inventory': InventoryPage,
  '/properties/access': AccessPage,

  '/finance/revenue': AnalyticsPage,
  '/finance/expenses': ExpensesPage,
  '/finance/statements': StatementsPage,
  '/finance/payouts': PayoutsPage,

  '/owners': OwnersPage,
  '/owners/contracts': ContractsPage,

  '/performance/analytics': AnalyticsPage,
  '/performance/pricing': PricingPage,
  '/performance/reviews': ReviewsPage,

  '/communication/inbox': InboxPage,
  '/communication/automations': AutomationsPage,

  '/system/users': UsersPage,
  '/system/integrations': IntegrationsPage,
  '/system/settings': SettingsPage,
};

function Routed() {
  const { user, loading } = useSession();
  const [path, navigate] = useHashRoute();

  if (loading) return null;

  // Emailed reset links carry a token in the query part of the hash
  // (#/reset-password?token=...) and must work with no session at all — this
  // takes priority over both the signed-out and forced-change-password screens.
  const [pathname, query] = path.split('?');
  if (pathname === '/reset-password') {
    const token = new URLSearchParams(query).get('token');
    if (token) return <LoginPage resetToken={token} />;
  }

  if (!user) return <LoginPage />;
  if (user.mustChangePassword && path !== '/change-password') {
    return <LoginPage forceChangePassword />;
  }

  // Field roles get a single-column shell with 44px targets, not the desk nav.
  if (user.role === 'housekeeper' || user.role === 'technician') {
    return <FieldShell><FieldTodayPage /></FieldShell>;
  }

  // Owners see only their own portal, whatever the address bar says.
  if (user.role === 'owner') {
    return <OwnerShell><OwnerPortalPage /></OwnerShell>;
  }

  // Record routes carry an id, so they are matched before the static table.
  const unitMatch = pathname.match(/^\/properties\/units\/(.+)$/);
  if (unitMatch) {
    return (
      <AppShell path="/properties/units" navigate={navigate}>
        <UnitRecordPage unitId={decodeURIComponent(unitMatch[1])} />
      </AppShell>
    );
  }

  const Page = ROUTES[pathname] ?? NotDesignedPage;
  return (
    <AppShell path={pathname} navigate={navigate}>
      <Page />
    </AppShell>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <Routed />
      </ToastProvider>
    </SessionProvider>
  );
}

export { HOME };
