// Conts only: a ledger screen opened without the Ledger area goes to the Conts home screen.
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { canUseLedger } from "./ledger";
import { CONTS_HOME } from "./navOnly";

export function ContsLedgerGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!canUseLedger(user?.permissions)) return <Navigate to={CONTS_HOME} replace />;
  return <>{children}</>;
}
