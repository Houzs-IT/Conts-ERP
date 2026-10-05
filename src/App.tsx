import { lazy, Suspense } from 'react';
import { Routes, Route, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider } from './components/Toast';
import AppShell from './components/AppShell';
import FieldShell from './components/FieldShell';
import UpdateNotice from './components/UpdateNotice';
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
const AirbnbImportPage = lazy(() => import('./pages/AirbnbImportPage'));
const UnitRecordPage = lazy(() => import('./pages/UnitRecordPage'));
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
const AccessPage = lazy(() => import('./pages/AccessPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'));
const StatementsPage = lazy(() => import('./pages/StatementsPage'));
const PayoutsPage = lazy(() => import('./pages/PayoutsPage'));
const OwnersPage = lazy(() => import('./pages/OwnersPage'));
const OwnerProfilePage = lazy(() => import('./pages/OwnerProfilePage'));
const ContractsPage = lazy(() => import('./pages/ContractsPage'));
const PricingPage = lazy(() => import('./pages/PricingPage'));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage'));
const InboxPage = lazy(() => import('./pages/InboxPage'));
const AutomationsPage = lazy(() => import('./pages/AutomationsPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const NotDesignedPage = lazy(() => import('./pages/NotDesignedPage'));
const PlaceholderPage = lazy(() => import('./pages/PlaceholderPage'));
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
        <Route path="/properties/import-airbnb" element={<AirbnbImportPage />} />
        <Route path="/sales/consignment-notes" element={<ConsignmentNotesPage />} />
        <Route path="/procurement/stock-transfers" element={<StockTransfersPage />} />
        <Route path="/procurement/stock-takes" element={<StockTakesPage />} />
        <Route path="/finance/revenue" element={<AnalyticsPage />} />
        <Route path="/finance/expenses" element={<ExpensesPage />} />
        <Route path="/finance/statements" element={<StatementsPage />} />
        <Route path="/finance/payouts" element={<PayoutsPage />} />
        <Route path="/owners" element={<OwnersPage />} />
        <Route path="/owners/:id" element={<OwnerProfileRoute />} />
        <Route path="/owners/contracts" element={<ContractsPage />} />
        <Route path="/performance/analytics" element={<AnalyticsPage />} />
        <Route path="/performance/pricing" element={<PricingPage />} />
        <Route path="/performance/reviews" element={<ReviewsPage />} />
        <Route path="/communication/inbox" element={<InboxPage />} />
        <Route path="/communication/automations" element={<AutomationsPage />} />
        <Route path="/system/users" element={<UsersPage />} />
        <Route path="/system/integrations" element={<IntegrationsPage />} />
        <Route path="/system/settings" element={<SettingsPage />} />
        <Route path="/system/audit" element={<AuditPage />} />
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
      </ToastProvider>
    </SessionProvider>
  );
}

export { HOME };
