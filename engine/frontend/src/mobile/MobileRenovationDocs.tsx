// Conts only: the renovation sales documents (quotations, their sales orders, variation orders, package
// templates, terms and letterheads) on a phone. The owner wants the same functions as on a computer (14 Oct
// 2026), and the desktop screens already lay themselves out for a narrow window, so the phone mounts those
// very screens under their own addresses instead of keeping a second copy that would drift from them.
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Scm2990Shell from "../pages/scm-v2/Scm2990Shell";
import { CONTS_EMBEDDED } from "../conts/embed";

const QuotationsList = lazy(() => import("../pages/renovation/QuotationsList").then((m) => ({ default: m.QuotationsList })));
const QuotationEditor = lazy(() => import("../pages/renovation/QuotationEditor").then((m) => ({ default: m.QuotationEditor })));
const QuotationTemplates = lazy(() => import("../pages/renovation/QuotationTemplates").then((m) => ({ default: m.QuotationTemplates })));
const QuotationTemplateEditor = lazy(() => import("../pages/renovation/QuotationTemplates").then((m) => ({ default: m.QuotationTemplateEditor })));
const RenovationSalesOrder = lazy(() => import("../pages/renovation/RenovationSalesOrder").then((m) => ({ default: m.RenovationSalesOrder })));
const VariationOrderEditor = lazy(() => import("../pages/renovation/VariationOrderEditor").then((m) => ({ default: m.VariationOrderEditor })));
const RenovationSettings = lazy(() => import("../pages/renovation/RenovationSettings").then((m) => ({ default: m.RenovationSettings })));

export function MobileRenovationDocs({ onBack }: { onBack: () => void }) {
  return (
    <div className="conts-reno-docs" style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "var(--app-bg, #faf8f4)" }}>
      {/* The page header pins itself under the desktop's phone top bar (top-14), which is not drawn here. */}
      <style>{".conts-reno-docs .sticky.top-14 { top: 0; }"}</style>
      {/* Inside Property OS its own menu is the way out; on its own the phone app needs one. */}
      {!CONTS_EMBEDDED && (
        <button type="button" onClick={onBack}
          style={{ flex: "none", textAlign: "left", background: "#fff", border: "none", borderBottom: "1px solid var(--line, #e6e2da)", padding: "calc(env(safe-area-inset-top) + 12px) 16px 12px", fontFamily: "inherit", fontSize: 14, fontWeight: 600 }}>
          {"‹"} Menu
        </button>
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "0 14px 32px" }}>
        <Scm2990Shell>
          <Suspense fallback={<div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "#8a8f86" }}>Loading…</div>}>
            <Routes>
              <Route path="/scm/renovation/quotations" element={<QuotationsList />} />
              <Route path="/scm/renovation/quotations/:id" element={<QuotationEditor />} />
              <Route path="/scm/renovation/templates" element={<QuotationTemplates />} />
              <Route path="/scm/renovation/templates/:id" element={<QuotationTemplateEditor />} />
              <Route path="/scm/renovation/contracts/:docNo" element={<RenovationSalesOrder />} />
              <Route path="/scm/renovation/variation-orders/:id" element={<VariationOrderEditor />} />
              <Route path="/scm/renovation/settings" element={<RenovationSettings />} />
              <Route path="*" element={<Navigate to="/scm/renovation/quotations" replace />} />
            </Routes>
          </Suspense>
        </Scm2990Shell>
      </div>
    </div>
  );
}
