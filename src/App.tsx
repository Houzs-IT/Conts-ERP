import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { readDevice } from './lib/deviceClass';
import { CrashScreen } from './components/CrashScreen';
import { Routes, Route, Outlet, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider } from './components/Toast';
import ViewAs from './components/ViewAs';
import TwoStepPrompt from './components/TwoStepPrompt';
import AppShell from './components/AppShell';
import UpdateNotice from './components/UpdateNotice';
import OwnerShell from './components/OwnerShell';
import LoginPage from './pages/LoginPage';
import { HOME, homeFor, screenClosed, switchedOff } from './lib/navigation';
import { setNavigate } from './lib/go';
import { BootScreen, PageShown, PageSkeleton } from './components/Loading';

/** react-router (ERP convention) with route-level code splitting — every page is
 *  lazy-loaded so the initial bundle stays small. Plain addresses (/owners/5); main.tsx moves old
 *  `#/...` links to them, and Cloudflare Pages answers any unknown address with index.html. */
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'));
const OwnerShowcasePage = lazy(() => import('./pages/showcase/OwnerShowcasePage'));
const ShowcaseControlPage = lazy(() => import('./pages/showcase/ShowcaseControlPage'));
const OwnerPortalDemoPage = lazy(() => import('./pages/showcase/OwnerPortalPage'));
const OwnerOverallReportPage = lazy(() => import('./pages/OwnerOverallReportPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const BookingsPage = lazy(() => import('./pages/BookingsPage'));
const GuestsPage = lazy(() => import('./pages/GuestsPage'));
const OperationsTodayPage = lazy(() => import('./pages/OperationsTodayPage'));
const CleaningPage = lazy(() => import('./pages/CleaningPage'));
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'));
const MaintenancePage = lazy(() => import('./pages/MaintenancePage'));
import SupplyChainEngine, { signInToEngineEarly } from './components/SupplyChainEngine';
import { ENGINE_PATH } from './lib/scmEngine';
import { useApi } from './lib/useApi';
const UnitsPage = lazy(() => import('./pages/UnitsPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'));
const ProductModelsPage = lazy(() => import('./pages/ProductModelsPage'));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage'));
const WarehousesPage = lazy(() => import('./pages/WarehousesPage'));
const PurchaseOrdersPage = lazy(() => import('./pages/PurchaseOrdersPage'));
const GoodsReceiptsPage = lazy(() => import('./pages/GoodsReceiptsPage'));
const PurchaseInvoicesPage = lazy(() => import('./pages/PurchaseInvoicesPage'));
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
const CreditNotesPage = lazy(() => import('./pages/CreditNotesPage'));
const AirbnbReturnPage = lazy(() => import('./pages/AirbnbReturnPage'));
const ConsignmentNotesPage = lazy(() => import('./pages/ConsignmentNotesPage'));
const StockTransfersPage = lazy(() => import('./pages/StockTransfersPage'));
const StockTakesPage = lazy(() => import('./pages/StockTakesPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'));
const UnitPnlPage = lazy(() => import('./pages/UnitPnlPage'));
const YearlyReportPage = lazy(() => import('./pages/YearlyReportPage'));
const StatementDetailPage = lazy(() => import('./pages/StatementDetailPage'));
const OwnerIncomeReportPage = lazy(() => import('./pages/OwnerIncomeReportPage'));
const StatementsPrintPage = lazy(async () => ({ default: (await import('./pages/OwnerIncomeReportPage')).StatementsPrintPage }));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const OwnersPage = lazy(() => import('./pages/OwnersPage'));
const OwnerProfilePage = lazy(() => import('./pages/OwnerProfilePage'));
const ContractsPage = lazy(() => import('./pages/ContractsPage'));
const LettingsPage = lazy(() => import('./pages/LettingsPage'));
const ScheduledChangesPage = lazy(() => import('./pages/ScheduledChangesPage'));
const PricingPage = lazy(() => import('./pages/PricingPage'));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage'));
const InboxPage = lazy(() => import('./pages/InboxPage'));
const AutomationsPage = lazy(() => import('./pages/AutomationsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const CategoryAccessPage = lazy(() => import('./pages/CategoryAccessPage'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));
const HostPlatformImportPage = lazy(() => import('./pages/HostPlatformImportPage'));
const SystemHealthPage = lazy(() => import('./pages/SystemHealthPage'));
const ItSupportPage = lazy(() => import('./pages/ItSupportPage'));
const DcEmployeePerformancePage = lazy(() => import('./pages/DcEmployeePerformancePage'));
const DcHrEmptyPage = lazy(() => import('./pages/DcHrEmptyPage'));
const DcEmployeesPage = lazy(() => import('./pages/DcEmployeesPage'));
const MyClaimsPage = lazy(() => import('./pages/MyClaimsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const NotDesignedPage = lazy(() => import('./pages/NotDesignedPage'));
const PlaceholderPage = lazy(() => import('./pages/PlaceholderPage'));
// The portal's shell carries its four-language strings (src/lib/portalI18n.ts): only cleaners and technicians load it.
const FieldShell = lazy(() => import('./components/FieldShell'));
const FieldHome = lazy(() => import('./pages/FieldHome'));
const FieldClockPage = lazy(() => import('./pages/FieldClockPage'));
const FieldMePage = lazy(() => import('./pages/FieldMePage'));
const FieldPayPage = lazy(() => import('./pages/FieldPayPage'));
const FieldReceiptsPage = lazy(() => import('./pages/FieldReceiptsPage'));
const OwnerPortalPage = lazy(() => import('./pages/OwnerPortalPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const MobileSettingsHub = lazy(() => import('./components/MobileSettingsHub'));

/** The phone tab bar's Settings hub; a desktop has the full Settings page instead. */
function SettingsHome() {
  const navigate = useNavigate();
  return readDevice().cls === 'phone' ? <MobileSettingsHub navigate={(p: string) => navigate(p)} /> : <Navigate to="/system/settings" replace />;
}

/** A page's code is still downloading: its shape, inside the shell, after a short wait (Loading.tsx). */
const Fallback = () => <PageSkeleton />;

/** Desktop shell as a layout route; the matched page renders into <Outlet />. */
/** The Owner Showcase and its sample owner portal have no app shell around them, so they apply the Owner Showcase
 *  screen's access themselves. */
function ShowcaseRoute({ children }: { children: ReactNode }) {
  const { user } = useSession();
  if (screenClosed('/performance/showcase', user?.access)) return <Navigate to={user ? homeFor(user) : '/'} replace />;
  return <Suspense fallback={<Fallback />}>{children}</Suspense>;
}

function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  // Supply chain destinations open the engine's screens where it is set up, the built-in ones elsewhere.
  const enginePath = ENGINE_PATH[location.pathname];
  const engine = useApi<{ enabled: boolean }>('/supply-chain/engine');
  const viaEngine = !!enginePath && !!engine.data?.enabled;
  const lastEnginePath = useRef<string | null>(null);
  if (viaEngine) lastEnginePath.current = enginePath;
  // A screen whose area is closed to this person (Users and roles > Permissions) is not shown even by its address.
  const { user } = useSession();
  const closed = screenClosed(location.pathname, user?.access);
  useEffect(() => { if (engine.data?.enabled && user) signInToEngineEarly(user.id); }, [engine.data?.enabled, user?.id]);
  if (switchedOff(location.pathname)) return <Navigate to={user ? homeFor(user) : '/'} replace />;
  const engineShown = viaEngine && !closed;
  return (
    <AppShell path={location.pathname} navigate={(p: string) => navigate(p)} flush={viaEngine}>
      {lastEnginePath.current && (
        <div style={{ display: engineShown ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <SupplyChainEngine enginePath={lastEnginePath.current} active={engineShown} />
        </div>
      )}
      {closed ? <NoAccess />
        : viaEngine ? null
        : enginePath && !engine.data && engine.loading ? <Fallback />
        // Settings categories share one page, so an unsaved edit in one survives a visit to another.
        : <CrashScreen inline key={location.pathname.replace(/^\/system\/settings\/.*/, '/system/settings')}><Suspense fallback={<Fallback />}><PageShown /><Outlet /></Suspense></CrashScreen>}
    </AppShell>
  );
}

function NoAccess() {
  return (
    <div className="p-10 text-center">
      <h1 className="m-0 text-[18px] font-semibold">Your role does not have access to this screen</h1>
      <p className="mt-2 text-[13px] text-muted-ink">Management sets what each department and position can open, under Users and roles.</p>
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

/** The old Workers screen (Operations > Workers): its in-house lists are Employee Master now, and the tabs HR took
 *  over in 26 Oct 2026 keep their own addresses. Outside companies have their own tab, not a redirect target here. */
const WORKERS_MOVED: Record<string, string> = { attendance: 'attendance', leave: 'leave', payroll: 'payroll' };
function ToEmployees() {
  const asked = new URLSearchParams(useLocation().search).get('tab');
  return <Navigate replace to={`/hr/employees?tab=${(asked && WORKERS_MOVED[asked]) || 'employee-master'}`} />;
}

/** The old All tasks list: maintenance work opens Maintenance's History, everything else Cleaning's History. */
function ToTaskHistory() {
  const kind = new URLSearchParams(useLocation().search).get('kind');
  return <Navigate replace to={kind === 'maintenance' ? '/operations/maintenance' : '/operations/cleaning?tab=history'} />;
}

/** A screen that moved: its old address opens the new one and keeps the filters, because links in notifications,
 *  emails and bookmarks carry the old one. `add` sets extra query values, such as the Owners list's tab. */
function Moved({ to, add }: { to: string; add?: Record<string, string> }) {
  const q = new URLSearchParams(useLocation().search);
  for (const [k, v] of Object.entries(add ?? {})) q.set(k, v);
  const qs = q.toString();
  return <Navigate replace to={`${to}${qs ? `?${qs}` : ''}`} />;
}
function MovedStatement() {
  const { id = '' } = useParams();
  return <Moved to={`/owners/statements/${encodeURIComponent(id)}`} />;
}

function OwnerProfileRoute() {
  const { id = '' } = useParams();
  return <OwnerProfilePage ownerId={decodeURIComponent(id)} />;
}

function Routed() {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) return <BootScreen />;

  // Emailed reset links carry a token and must work with no session at all.
  if (location.pathname === '/reset-password') {
    const token = new URLSearchParams(location.search).get('token');
    if (token) return <LoginPage resetToken={token} />;
  }
  if (!user) return <LoginPage />;
  // A temporary password (invite, or management's Reset password) must be replaced before anything else. Sign-in
  // sends the browser to /change-password, which has no screen of its own, so this holds on every address.
  if (user.mustChangePassword) {
    return <LoginPage key="change-password" forceChangePassword />;
  }
  // Management requires two-step sign-in for this role and it is not set up: nothing else answers until it is.
  if (user.twoStepSetupRequired) {
    return (
      <div className="flex-1 min-h-screen bg-page box-border px-4 py-6 sm:px-10 sm:py-10">
        <div className="max-w-[760px] mx-auto"><Suspense fallback={<Fallback />}><AccountPage gate /></Suspense></div>
      </div>
    );
  }
  const account = location.pathname === '/account';
  // Field roles: single-column 44px shell, not the desk nav.
  if (user.role === 'housekeeper' || user.role === 'technician') {
    // Cleaners' and technicians' screens moved from /field (then /worker) to /portal; old bookmarks and links follow.
    if (/^\/(field|worker)(\/|$)/.test(location.pathname)) return <Navigate to={location.pathname.replace(/^\/(field|worker)/, '/portal') + location.search} replace />;
    return <Suspense fallback={<Fallback />}><FieldShell><Suspense fallback={<Fallback />}>{account ? <AccountPage /> : location.pathname.startsWith('/portal/clock') ? <FieldClockPage /> : location.pathname.startsWith('/portal/me') ? <FieldMePage /> : location.pathname.startsWith('/portal/pay') ? <FieldPayPage /> : location.pathname.startsWith('/portal/receipts') ? <FieldReceiptsPage /> : <FieldHome />}</Suspense></FieldShell></Suspense>;
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
  // The cleaners' and technicians' portal (and its old /field and /worker links) has no desk screen: go home.
  if (/^\/(portal|field|worker)(\/|$)/.test(location.pathname)) return <Navigate to={HOME[user.role]} replace />;

  return (
    <Routes>
      {/* The Owner Income Report prints on its own: no app shell around it. */}
      <Route path="/finance/statements/:id/report" element={<Suspense fallback={<Fallback />}><OwnerIncomeReportPage /></Suspense>} />
      <Route path="/finance/statements/print" element={<Suspense fallback={<Fallback />}><StatementsPrintPage /></Suspense>} />
      {/* Sales staff present it to a prospective owner: full screen, no menu (CONTS-0006). */}
      <Route path="/performance/showcase" element={<ShowcaseRoute><OwnerShowcasePage /></ShowcaseRoute>} />
      <Route path="/performance/showcase/owner" element={<ShowcaseRoute><OwnerPortalDemoPage /></ShowcaseRoute>} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/portfolio/owner-report" element={<OwnerOverallReportPage />} />
        <Route path="/reservations/calendar" element={<CalendarPage />} />
        <Route path="/reservations/bookings" element={<BookingsPage />} />
        <Route path="/reservations/guests" element={<GuestsPage />} />
        <Route path="/operations/today" element={<OperationsTodayPage />} />
        <Route path="/operations/cleaning" element={<CleaningPage />} />
        <Route path="/hr/employees" element={<EmployeesPage />} />
        <Route path="/operations/workers" element={<ToEmployees />} />
        <Route path="/operations/cleaners" element={<ToEmployees />} />
        <Route path="/operations/maintenance" element={<MaintenancePage />} />
        {/* Housekeeping is Cleaning; Inspections is gone; All tasks is the History tab (owner, 10 Oct). */}
        <Route path="/operations/housekeeping" element={<Navigate to="/operations/cleaning" replace />} />
        <Route path="/operations/inspections" element={<Navigate to="/operations/cleaning" replace />} />
        <Route path="/operations/inspections/*" element={<Navigate to="/operations/cleaning" replace />} />
        <Route path="/operations/tasks" element={<ToTaskHistory />} />
        <Route path="/properties" element={<ToUnits />} />
        <Route path="/properties/units" element={<UnitsPage unitId="" />} />
        <Route path="/properties/units/:id" element={<UnitsRoute />} />
        <Route path="/properties/access" element={<ToUnits tab="access" />} />
        <Route path="/procurement/products" element={<ProductsPage />} />
        <Route path="/procurement/suppliers" element={<SuppliersPage />} />
        <Route path="/procurement/product-models" element={<ProductModelsPage />} />
        <Route path="/procurement/categories" element={<CategoriesPage />} />
        <Route path="/procurement/warehouses" element={<WarehousesPage />} />
        <Route path="/procurement/purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="/procurement/goods-received" element={<GoodsReceiptsPage />} />
        <Route path="/procurement/purchase-invoices" element={<PurchaseInvoicesPage />} />
        {/* Payment vouchers and Payables & receivables moved to Finance, in the engine (finance phase 1). */}
        <Route path="/procurement/payment-vouchers" element={<Moved to="/finance/payment-vouchers" />} />
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
        <Route path="/accounting" element={<Moved to="/finance/creditor-ageing" />} />
        <Route path="/accounting/credit-notes" element={<CreditNotesPage />} />
        <Route path="/channex/airbnb-return" element={<AirbnbReturnPage />} />
        <Route path="/sales/consignment-notes" element={<ConsignmentNotesPage />} />
        <Route path="/procurement/stock-transfers" element={<StockTransfersPage />} />
        <Route path="/procurement/stock-takes" element={<StockTakesPage />} />
        {/* Revenue was the same screen as Performance > Analytics (UI audit); one route, the old address redirects. */}
        <Route path="/finance/revenue" element={<Navigate to="/performance/analytics" replace />} />
        <Route path="/performance" element={<Navigate to="/performance/analytics" replace />} />
        <Route path="/performance/showcase-control" element={<ShowcaseControlPage />} />
        {/* Owner statements and owner payouts moved onto the owner; Expenses is Accounts payable (owner, 11 Oct 2026). */}
        <Route path="/finance/payables" element={<ExpensesPage />} />
        <Route path="/finance/utility-bills" element={<ExpensesPage utilities />} />
        <Route path="/finance/unit-pnl" element={<UnitPnlPage />} />
        <Route path="/reports/yearly" element={<YearlyReportPage />} />
        <Route path="/finance/expenses" element={<Moved to="/finance/payables" />} />
        <Route path="/finance/statements" element={<Moved to="/owners" add={{ view: 'statements' }} />} />
        <Route path="/finance/statements/:id" element={<MovedStatement />} />
        <Route path="/finance/payouts" element={<Moved to="/owners" add={{ view: 'payouts' }} />} />
        <Route path="/finance/approvals" element={<ApprovalsPage />} />
        {/* The same screens in the supply chain Finance group, so that sidebar stays put (finance phase 1). */}
        <Route path="/supply/finance/payables" element={<ExpensesPage />} />
        <Route path="/supply/finance/utility-bills" element={<ExpensesPage utilities />} />
        <Route path="/supply/finance/unit-pnl" element={<UnitPnlPage />} />
        <Route path="/supply/finance/approvals" element={<ApprovalsPage />} />
        {/* Project monitor was dropped (owner, 11 Oct 2026): old links open the Schedule. */}
        <Route path="/projects/monitor" element={<Moved to="/projects/calendar" />} />
        <Route path="/owners" element={<OwnersPage />} />
        <Route path="/owners/:id" element={<OwnerProfileRoute />} />
        <Route path="/owners/contracts" element={<ContractsPage />} />
        <Route path="/properties/agent-to-let" element={<LettingsPage />} />
        <Route path="/properties/scheduled-changes" element={<ScheduledChangesPage />} />
        <Route path="/owners/statements" element={<Moved to="/owners" add={{ view: 'statements' }} />} />
        <Route path="/owners/statements/:id" element={<StatementDetailPage />} />
        <Route path="/performance/analytics" element={<AnalyticsPage />} />
        <Route path="/performance/pricing" element={<PricingPage />} />
        <Route path="/performance/reviews" element={<ReviewsPage />} />
        <Route path="/communication/inbox" element={<InboxPage />} />
        <Route path="/communication/automations" element={<AutomationsPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/change-password" element={<Navigate to="/" replace />} />
        <Route path="/system/users" element={<UsersPage />} />
        <Route path="/system/category-access" element={<CategoryAccessPage />} />
        <Route path="/system/integrations" element={<IntegrationsPage />} />
        <Route path="/system/integrations/hostplatform" element={<HostPlatformImportPage />} />
        <Route path="/settings" element={<SettingsHome />} />
        <Route path="/system/settings/:section?" element={<SettingsPage />} />
        <Route path="/system/audit" element={<Navigate to="/system/health" replace />} />
        <Route path="/system/health" element={<SystemHealthPage />} />
        <Route path="/system/it-support" element={<ItSupportPage />} />
        <Route path="/supply/it-support" element={<ItSupportPage />} />
        <Route path="/my-claims" element={<MyClaimsPage />} />
        <Route path="/supply/my-claims" element={<MyClaimsPage />} />
        <Route path="/supply/hr/employees" element={<DcEmployeesPage />} />
        <Route path="/supply/hr/attendance" element={<DcHrEmptyPage page="attendance" />} />
        <Route path="/supply/hr/punch-sites" element={<DcHrEmptyPage page="punch-sites" />} />
        <Route path="/supply/hr/performance" element={<DcEmployeePerformancePage />} />
        <Route path="*" element={<NotDesignedPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  // BrowserRouter, not createBrowserRouter: the data router adds 17 KB gzipped to the entry script for features
  // nothing here uses. go.ts gets navigate from here instead.
  const navigate = useNavigate();
  useEffect(() => setNavigate(navigate), [navigate]);
  return (
    <SessionProvider>
      <ToastProvider>
        <Routed />
        <UpdateNotice />
        <ViewAs />
        <TwoStepPrompt />
      </ToastProvider>
    </SessionProvider>
  );
}

export { HOME };
