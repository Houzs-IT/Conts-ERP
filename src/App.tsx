import { lazy, Suspense } from 'react';
import { CrashScreen } from './components/CrashScreen';
import { Routes, Route, Outlet, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider } from './components/Toast';
import ViewAs from './components/ViewAs';
import AppShell from './components/AppShell';
import FieldShell from './components/FieldShell';
import UpdateNotice from './components/UpdateNotice';
import OwnerShell from './components/OwnerShell';
import LoginPage from './pages/LoginPage';
import { HOME, screenClosed } from './lib/navigation';

/** react-router (ERP convention) with route-level code splitting — every page is
 *  lazy-loaded so the initial bundle stays small. HashRouter (see main.tsx) keeps
 *  the app a static Cloudflare Pages build with no server rewrites, and existing
 *  `#/...` links keep working. */
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const BookingsPage = lazy(() => import('./pages/BookingsPage'));
const GuestsPage = lazy(() => import('./pages/GuestsPage'));
const OperationsTodayPage = lazy(() => import('./pages/OperationsTodayPage'));
const CleaningPage = lazy(() => import('./pages/CleaningPage'));
const CleanersPage = lazy(() => import('./pages/CleanersPage')); // added: housekeeping cleaner roster
const MaintenancePage = lazy(() => import('./pages/MaintenancePage'));
import SupplyChainEngine from './components/SupplyChainEngine';
import { ENGINE_PATH } from './lib/scmEngine';
import { useApi } from './lib/useApi';
const UnitsPage = lazy(() => import('./pages/UnitsPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'));
const ProductModelsPage = lazy(() => import('./pages/ProductModelsPage'));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage'));
const WarehousesPage = lazy(() => import('./pages/WarehousesPage'));
const PurchaseOrdersPage = lazy(() => import('./pages/PurchaseOrdersPage'));
const GoodsReceiptsPage = lazy(() => import('./pages/GoodsReceiptsPage'));
const PurchaseInvoicesPage = lazy(() => import('./pages/PurchaseInvoicesPage'));
const PaymentVouchersPage = lazy(() => import('./pages/PaymentVouchersPage'));
const PurchaseReturnsPage = lazy(() => import('./pages/PurchaseReturnsPage'));
const PurchaseConsignmentPage = lazy(() => import('./pages/PurchaseConsignmentPage'));
const StockPage = lazy(() => import('./pages/StockPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const SalesOrdersPage = lazy(() => import('./pages/SalesOrdersPage'));
const DeliveryOrdersPage = lazy(() => import('./pages/DeliveryOrdersPage'));
const SalesInvoicesPage = lazy(() => import('./pages/SalesInvoicesPage'));
const SalesReturnsPage = lazy(() => import('./pages/SalesReturnsPage'));
const SalesOrderAmendmentPage = lazy(() => import('./pages/SalesOrderAmendmentPage'));
const UnbilledDeliveriesPage = lazy(() => import('./pages/UnbilledDeliveriesPage'));
const DriversPage = lazy(() => import('./pages/DriversPage'));
const VehiclesPage = lazy(() => import('./pages/VehiclesPage'));
const ThreePLCompaniesPage = lazy(() => import('./pages/ThreePLCompaniesPage'));
const DriverLeavePage = lazy(() => import('./pages/DriverLeavePage'));
const DeliveryZonesPage = lazy(() => import('./pages/DeliveryZonesPage'));
const DeliveryResidenceRulesPage = lazy(() => import('./pages/DeliveryResidenceRulesPage'));
const RateCardsPage = lazy(() => import('./pages/RateCardsPage'));
const RacksBinsPage = lazy(() => import('./pages/RacksBinsPage'));
const AdjustmentsPage = lazy(() => import('./pages/AdjustmentsPage'));
const LoadingListPage = lazy(() => import('./pages/LoadingListPage'));
const FleetHealthPage = lazy(() => import('./pages/FleetHealthPage'));
const CoverageFleetPage = lazy(() => import('./pages/CoverageFleetPage'));
const DpOrdersPage = lazy(() => import('./pages/DpOrdersPage'));
const DeliveryPlanningPage = lazy(() => import('./pages/DeliveryPlanningPage'));
const DeliveryDateArrangementPage = lazy(() => import('./pages/DeliveryDateArrangementPage'));
const DeliveryTimeArrangementPage = lazy(() => import('./pages/DeliveryTimeArrangementPage'));
const LastMileDeliveryPage = lazy(() => import('./pages/LastMileDeliveryPage'));
const FabricsPage = lazy(() => import('./pages/FabricsPage'));
const MrpPage = lazy(() => import('./pages/MrpPage'));
const AccountingPage = lazy(() => import('./pages/AccountingPage'));
const CreditNotesPage = lazy(() => import('./pages/CreditNotesPage'));
const AirbnbReturnPage = lazy(() => import('./pages/AirbnbReturnPage'));
const ConsignmentNotesPage = lazy(() => import('./pages/ConsignmentNotesPage'));
const StockTransfersPage = lazy(() => import('./pages/StockTransfersPage'));
const StockTakesPage = lazy(() => import('./pages/StockTakesPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'));
const StatementsPage = lazy(() => import('./pages/StatementsPage'));
const StatementDetailPage = lazy(() => import('./pages/StatementDetailPage'));
const OwnerIncomeReportPage = lazy(() => import('./pages/OwnerIncomeReportPage'));
const PayoutsPage = lazy(() => import('./pages/PayoutsPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const GuestDocumentsPage = lazy(() => import('./pages/GuestDocumentsPage'));
const OwnersPage = lazy(() => import('./pages/OwnersPage'));
const OwnerProfilePage = lazy(() => import('./pages/OwnerProfilePage'));
const ContractsPage = lazy(() => import('./pages/ContractsPage'));
const PricingPage = lazy(() => import('./pages/PricingPage'));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage'));
const InboxPage = lazy(() => import('./pages/InboxPage'));
const AutomationsPage = lazy(() => import('./pages/AutomationsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));
const HostPlatformImportPage = lazy(() => import('./pages/HostPlatformImportPage'));
const SystemHealthPage = lazy(() => import('./pages/SystemHealthPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotDesignedPage = lazy(() => import('./pages/NotDesignedPage'));
const PlaceholderPage = lazy(() => import('./pages/PlaceholderPage'));
const FieldTodayPage = lazy(() => import('./pages/FieldTodayPage'));
const OwnerPortalPage = lazy(() => import('./pages/OwnerPortalPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));

const Fallback = () => null;

/** Desktop shell as a layout route; the matched page renders into <Outlet />. */
function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  // Supply chain destinations open the engine's screens where it is set up, the built-in ones elsewhere.
  const enginePath = ENGINE_PATH[location.pathname];
  const engine = useApi<{ enabled: boolean }>('/supply-chain/engine');
  const viaEngine = !!enginePath && !!engine.data?.enabled;
  // A screen whose area is closed to this role (Users and roles > Permissions) is not shown even by its address.
  const { user } = useSession();
  const closed = screenClosed(location.pathname, user?.access);
  return (
    <AppShell path={location.pathname} navigate={(p: string) => navigate(p)} flush={viaEngine}>
      {closed ? <NoAccess />
        : viaEngine ? <SupplyChainEngine enginePath={enginePath} />
        : enginePath && !engine.data && engine.loading ? <Fallback />
        : <CrashScreen inline key={location.pathname}><Suspense fallback={<Fallback />}><Outlet /></Suspense></CrashScreen>}
    </AppShell>
  );
}

function NoAccess() {
  return (
    <div className="p-10 text-center">
      <h1 className="m-0 text-[18px] font-semibold">Your role does not have access to this screen</h1>
      <p className="mt-2 text-[13px] text-muted-ink">Management sets what each role can open, under Users and roles.</p>
    </div>
  );
}

function UnitsRoute() {
  const { id = '' } = useParams();
  return <UnitsPage unitId={decodeURIComponent(id)} />;
}

/** Properties and Access and keys became tabs of Units. Old links keep working: `?unit=` opens that unit. */
function ToUnits({ tab }: { tab?: string }) {
  const q = new URLSearchParams(useLocation().search);
  const unit = q.get('unit') ?? q.get('unitId');
  const t = tab ?? q.get('tab');
  return <Navigate replace to={`/properties/units${unit ? `/${encodeURIComponent(unit)}` : ''}${t ? `?tab=${encodeURIComponent(t)}` : ''}`} />;
}

/** The old All tasks list: maintenance work opens Maintenance's History, everything else Cleaning's History. */
function ToTaskHistory() {
  const kind = new URLSearchParams(useLocation().search).get('kind');
  return <Navigate replace to={kind === 'maintenance' ? '/operations/maintenance' : '/operations/cleaning?tab=history'} />;
}

function OwnerProfileRoute() {
  const { id = '' } = useParams();
  return <OwnerProfilePage ownerId={decodeURIComponent(id)} />;
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
  // A temporary password (invite, or management's Reset password) must be replaced before anything else. Sign-in
  // sends the browser to #/change-password, which has no screen of its own, so this holds on every address.
  if (user.mustChangePassword) {
    return <LoginPage key="change-password" forceChangePassword />;
  }
  // Management requires two-step sign-in for this role and it is not set up: nothing else answers until it is.
  if (user.twoStepSetupRequired) {
    return (
      <div className="flex-1 min-h-dvh bg-page box-border px-4 py-6 sm:px-10 sm:py-10">
        <div className="max-w-[760px] mx-auto"><Suspense fallback={<Fallback />}><AccountPage gate /></Suspense></div>
      </div>
    );
  }
  const account = location.pathname === '/account';
  // Field roles: single-column 44px shell, not the desk nav.
  if (user.role === 'housekeeper' || user.role === 'technician') {
    return <FieldShell><Suspense fallback={<Fallback />}>{account ? <AccountPage /> : <FieldTodayPage />}</Suspense></FieldShell>;
  }
  // Owners see only their own portal, whatever the address bar says.
  if (user.role === 'owner') {
    return (
      <Routes>
        {/* Their own Owner Income Report (the API checks it is theirs and final), printed without the shell. */}
        <Route path="/finance/statements/:id/report" element={<Suspense fallback={<Fallback />}><OwnerIncomeReportPage /></Suspense>} />
        <Route path="/account" element={<OwnerShell><Suspense fallback={<Fallback />}><AccountPage /></Suspense></OwnerShell>} />
        <Route path="*" element={<OwnerShell><Suspense fallback={<Fallback />}><OwnerPortalPage /></Suspense></OwnerShell>} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* The Owner Income Report prints on its own: no app shell around it. */}
      <Route path="/finance/statements/:id/report" element={<Suspense fallback={<Fallback />}><OwnerIncomeReportPage /></Suspense>} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/reservations/calendar" element={<CalendarPage />} />
        <Route path="/reservations/bookings" element={<BookingsPage />} />
        <Route path="/reservations/guests" element={<GuestsPage />} />
        <Route path="/operations/today" element={<OperationsTodayPage />} />
        <Route path="/operations/cleaning" element={<CleaningPage />} />
        <Route path="/operations/cleaners" element={<CleanersPage />} />
        <Route path="/operations/maintenance" element={<MaintenancePage />} />
        {/* Housekeeping is Cleaning; Inspections is gone; All tasks is the History tab (owner, 10 Oct). */}
        <Route path="/operations/housekeeping" element={<Navigate to="/operations/cleaning" replace />} />
        <Route path="/operations/inspections" element={<Navigate to="/operations/cleaning" replace />} />
        <Route path="/operations/inspections/*" element={<Navigate to="/operations/cleaning" replace />} />
        <Route path="/operations/tasks" element={<ToTaskHistory />} />
        <Route path="/properties" element={<ToUnits />} />
        <Route path="/properties/units" element={<UnitsPage unitId="" />} />
        <Route path="/properties/units/:id" element={<UnitsRoute />} />
        <Route path="/properties/inventory" element={<InventoryPage />} />
        <Route path="/properties/access" element={<ToUnits tab="access" />} />
        <Route path="/procurement/products" element={<ProductsPage />} />
        <Route path="/procurement/suppliers" element={<SuppliersPage />} />
        <Route path="/procurement/product-models" element={<ProductModelsPage />} />
        <Route path="/procurement/categories" element={<CategoriesPage />} />
        <Route path="/procurement/warehouses" element={<WarehousesPage />} />
        <Route path="/procurement/purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="/procurement/goods-received" element={<GoodsReceiptsPage />} />
        <Route path="/procurement/purchase-invoices" element={<PurchaseInvoicesPage />} />
        <Route path="/procurement/payment-vouchers" element={<PaymentVouchersPage />} />
        <Route path="/procurement/purchase-returns" element={<PurchaseReturnsPage />} />
        <Route path="/procurement/consignment" element={<PurchaseConsignmentPage />} />
        <Route path="/procurement/stock" element={<StockPage />} />
        <Route path="/procurement/racks" element={<RacksBinsPage />} />
        <Route path="/procurement/adjustments" element={<AdjustmentsPage />} />
        <Route path="/procurement/loading-list" element={<LoadingListPage />} />
        <Route path="/sales/customers" element={<CustomersPage />} />
        <Route path="/sales/orders" element={<SalesOrdersPage />} />
        <Route path="/sales/delivery-orders" element={<DeliveryOrdersPage />} />
        <Route path="/sales/invoices" element={<SalesInvoicesPage />} />
        <Route path="/sales/returns" element={<SalesReturnsPage />} />
        <Route path="/sales/amendments" element={<SalesOrderAmendmentPage />} />
        {/* Target-nav items whose screens are being built out (placeholders keep nav complete). */}
        <Route path="/consignment/order" element={<PlaceholderPage title="Consignment order" />} />
        <Route path="/consignment/return" element={<PlaceholderPage title="Consignment return" />} />
        <Route path="/consignment/purchase-receive" element={<PlaceholderPage title="Purchase consignment receive" />} />
        <Route path="/consignment/purchase-return" element={<PlaceholderPage title="Purchase consignment return" />} />
        <Route path="/procurement/po-amendments" element={<PlaceholderPage title="PO amendments" />} />
        <Route path="/procurement/cancellations" element={<PlaceholderPage title="Cancellation requests" />} />
        <Route path="/sales/unbilled" element={<UnbilledDeliveriesPage />} />
        <Route path="/transport/drivers" element={<DriversPage />} />
        <Route path="/transport/vehicles" element={<VehiclesPage />} />
        <Route path="/transport/3pl" element={<ThreePLCompaniesPage />} />
        <Route path="/transport/driver-leave" element={<DriverLeavePage />} />
        <Route path="/transport/zones" element={<DeliveryZonesPage />} />
        <Route path="/transport/residence-rules" element={<DeliveryResidenceRulesPage />} />
        <Route path="/transport/rate-cards" element={<RateCardsPage />} />
        <Route path="/transport/fleet-health" element={<FleetHealthPage />} />
        <Route path="/transport/coverage" element={<CoverageFleetPage />} />
        <Route path="/transport/planning" element={<DeliveryPlanningPage />} />
        <Route path="/transport/dp-orders" element={<DpOrdersPage />} />
        <Route path="/transport/delivery-dates" element={<DeliveryDateArrangementPage />} />
        <Route path="/transport/delivery-times" element={<DeliveryTimeArrangementPage />} />
        <Route path="/transport/last-mile" element={<LastMileDeliveryPage />} />
        <Route path="/furniture/fabrics" element={<FabricsPage />} />
        <Route path="/procurement/mrp" element={<MrpPage />} />
        <Route path="/accounting" element={<AccountingPage />} />
        <Route path="/accounting/credit-notes" element={<CreditNotesPage />} />
        <Route path="/channex/airbnb-return" element={<AirbnbReturnPage />} />
        <Route path="/sales/consignment-notes" element={<ConsignmentNotesPage />} />
        <Route path="/procurement/stock-transfers" element={<StockTransfersPage />} />
        <Route path="/procurement/stock-takes" element={<StockTakesPage />} />
        {/* Revenue was the same screen as Performance > Analytics (UI audit); one route, the old address redirects. */}
        <Route path="/finance/revenue" element={<Navigate to="/performance/analytics" replace />} />
        <Route path="/performance" element={<Navigate to="/performance/analytics" replace />} />
        <Route path="/finance/expenses" element={<ExpensesPage />} />
        <Route path="/finance/statements" element={<StatementsPage />} />
        <Route path="/finance/statements/:id" element={<StatementDetailPage />} />
        <Route path="/finance/payouts" element={<PayoutsPage />} />
        <Route path="/finance/approvals" element={<ApprovalsPage />} />
        <Route path="/finance/documents" element={<GuestDocumentsPage />} />
        <Route path="/owners" element={<OwnersPage />} />
        <Route path="/owners/:id" element={<OwnerProfileRoute />} />
        <Route path="/owners/contracts" element={<ContractsPage />} />
        <Route path="/performance/analytics" element={<AnalyticsPage />} />
        <Route path="/performance/pricing" element={<PricingPage />} />
        <Route path="/performance/reviews" element={<ReviewsPage />} />
        <Route path="/communication/inbox" element={<InboxPage />} />
        <Route path="/communication/automations" element={<AutomationsPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/change-password" element={<Navigate to="/" replace />} />
        <Route path="/system/users" element={<UsersPage />} />
        <Route path="/system/integrations" element={<IntegrationsPage />} />
        <Route path="/system/integrations/hostplatform" element={<HostPlatformImportPage />} />
        <Route path="/system/settings" element={<SettingsPage />} />
        <Route path="/system/audit" element={<Navigate to="/system/health" replace />} />
        <Route path="/system/health" element={<SystemHealthPage />} />
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
        <UpdateNotice />
        <ViewAs />
      </ToastProvider>
    </SessionProvider>
  );
}

export { HOME };
