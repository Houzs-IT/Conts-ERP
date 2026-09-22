import { lazy, Suspense } from 'react';
import { Routes, Route, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider } from './components/Toast';
import AppShell from './components/AppShell';
import FieldShell from './components/FieldShell';
import OwnerShell from './components/OwnerShell';
import LoginPage from './pages/LoginPage';
import { HOME } from './lib/navigation';

/** react-router (ERP convention) with route-level code splitting — every page is
 *  lazy-loaded so the initial bundle stays small. HashRouter (see main.tsx) keeps
 *  the app a static Cloudflare Pages build with no server rewrites, and existing
 *  `#/...` links keep working. */
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const BookingsPage = lazy(() => import('./pages/BookingsPage'));
const GuestsPage = lazy(() => import('./pages/GuestsPage'));
const OperationsTodayPage = lazy(() => import('./pages/OperationsTodayPage'));
const HousekeepingPage = lazy(() => import('./pages/HousekeepingPage'));
const CleanersPage = lazy(() => import('./pages/CleanersPage')); // added: housekeeping cleaner roster
const MaintenancePage = lazy(() => import('./pages/MaintenancePage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const InspectionsPage = lazy(() => import('./pages/InspectionsPage'));
const PropertiesPage = lazy(() => import('./pages/PropertiesPage'));
const UnitRecordPage = lazy(() => import('./pages/UnitRecordPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const AccessPage = lazy(() => import('./pages/AccessPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'));
const StatementsPage = lazy(() => import('./pages/StatementsPage'));
const PayoutsPage = lazy(() => import('./pages/PayoutsPage'));
const OwnersPage = lazy(() => import('./pages/OwnersPage'));
const ContractsPage = lazy(() => import('./pages/ContractsPage'));
const PricingPage = lazy(() => import('./pages/PricingPage'));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage'));
const InboxPage = lazy(() => import('./pages/InboxPage'));
const AutomationsPage = lazy(() => import('./pages/AutomationsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotDesignedPage = lazy(() => import('./pages/NotDesignedPage'));
const FieldTodayPage = lazy(() => import('./pages/FieldTodayPage'));
const OwnerPortalPage = lazy(() => import('./pages/OwnerPortalPage'));

const Fallback = () => null;

/** Desktop shell as a layout route; the matched page renders into <Outlet />. */
function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <AppShell path={location.pathname} navigate={(p: string) => navigate(p)}>
      <Suspense fallback={<Fallback />}><Outlet /></Suspense>
    </AppShell>
  );
}

function UnitRecordRoute() {
  const { id = '' } = useParams();
  return <UnitRecordPage unitId={decodeURIComponent(id)} />;
}

function Routed() {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) return null;

  // Emailed reset links carry a token and must work with no session at all.
  if (location.pathname === '/reset-password') {
    const token = new URLSearchParams(location.search).get('token');
    if (token) return <LoginPage resetToken={token} />;
  }
  if (!user) return <LoginPage />;
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <LoginPage forceChangePassword />;
  }
  // Field roles: single-column 44px shell, not the desk nav.
  if (user.role === 'housekeeper' || user.role === 'technician') {
    return <FieldShell><Suspense fallback={<Fallback />}><FieldTodayPage /></Suspense></FieldShell>;
  }
  // Owners see only their own portal, whatever the address bar says.
  if (user.role === 'owner') {
    return <OwnerShell><Suspense fallback={<Fallback />}><OwnerPortalPage /></Suspense></OwnerShell>;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/reservations/calendar" element={<CalendarPage />} />
        <Route path="/reservations/bookings" element={<BookingsPage />} />
        <Route path="/reservations/guests" element={<GuestsPage />} />
        <Route path="/operations/today" element={<OperationsTodayPage />} />
        <Route path="/operations/housekeeping" element={<HousekeepingPage />} />
        <Route path="/operations/cleaners" element={<CleanersPage />} /> {/* added: cleaner roster */}
        <Route path="/operations/maintenance" element={<MaintenancePage />} />
        <Route path="/operations/tasks" element={<TasksPage />} />
        <Route path="/operations/inspections" element={<InspectionsPage />} />
        <Route path="/properties" element={<PropertiesPage />} />
        <Route path="/properties/units" element={<UnitRecordPage unitId="" />} />
        <Route path="/properties/units/:id" element={<UnitRecordRoute />} />
        <Route path="/properties/inventory" element={<InventoryPage />} />
        <Route path="/properties/access" element={<AccessPage />} />
        <Route path="/finance/revenue" element={<AnalyticsPage />} />
        <Route path="/finance/expenses" element={<ExpensesPage />} />
        <Route path="/finance/statements" element={<StatementsPage />} />
        <Route path="/finance/payouts" element={<PayoutsPage />} />
        <Route path="/owners" element={<OwnersPage />} />
        <Route path="/owners/contracts" element={<ContractsPage />} />
        <Route path="/performance/analytics" element={<AnalyticsPage />} />
        <Route path="/performance/pricing" element={<PricingPage />} />
        <Route path="/performance/reviews" element={<ReviewsPage />} />
        <Route path="/communication/inbox" element={<InboxPage />} />
        <Route path="/communication/automations" element={<AutomationsPage />} />
        <Route path="/system/users" element={<UsersPage />} />
        <Route path="/system/integrations" element={<IntegrationsPage />} />
        <Route path="/system/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotDesignedPage />} />
      </Route>
    </Routes>
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
