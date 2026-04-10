import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PeriodProvider } from "@/contexts/PeriodContext";
import { AppLayout } from "@/components/AppLayout";
import { usePermissions } from "@/hooks/usePermissions";
import { ShieldX } from "lucide-react";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import PlaceholderPage from "./pages/PlaceholderPage";
import CashBanks from "./pages/CashBanks";
import Receivables from "./pages/Receivables";
import Inventory from "./pages/Inventory";
import InventoryImport from "./pages/InventoryImport";

import InventoryReports from "./pages/InventoryReports";
import InventoryClosings from "./pages/InventoryClosings";
import InventoryCounting from "./pages/InventoryCounting";
import FixedAssetsDashboard from "./pages/FixedAssetsDashboard";
import FixedAssetsReconciliation from "./pages/FixedAssetsReconciliation";
import FixedAssetsItems from "./pages/FixedAssetsItems";
import Closing from "./pages/Closing";
import NfEntrada from "./pages/NfEntrada";
import ComprasNotasFiscais from "./pages/ComprasNotasFiscais";
import ComprasNotasServico from "./pages/ComprasNotasServico";
import ComprasCertificado from "./pages/ComprasCertificado";
import ComprasPedidosCompra from "./pages/ComprasPedidosCompra";
import Entidades from "./pages/Entidades";
import EntidadesUploadCodigos from "./pages/EntidadesUploadCodigos";
import Commodatum from "./pages/Commodatum";
import Taxes from "./pages/Taxes";
import Intercompany from "./pages/Intercompany";
import Settings from "./pages/Settings";
import CostCenters from "./pages/settings/CostCenters";
import ClassesRecDesp from "./pages/settings/ClassesRecDesp";
import UsersSettings from "./pages/settings/Users";
import Sales from "./pages/Sales";
import CreditCards from "./pages/CreditCards";
import CreditCardDetail from "./pages/CreditCardDetail";
import CreditCardInvoice from "./pages/CreditCardInvoice";
import Projetos from "./pages/Projetos";
import ProjetoRequisicoes from "./pages/ProjetoRequisicoes";
import ContasPagar from "./pages/ContasPagar";
import ContasPagarDashboard from "./pages/ContasPagarDashboard";
import ConfigSyncJobs from "./pages/ConfigSyncJobs";
import EmailNfe from "./pages/EmailNfe";
import SuprimentosRequisicoes from "./pages/SuprimentosRequisicoes";
import SuprimentosRequisicaoNova from "./pages/SuprimentosRequisicaoNova";
import SuprimentosRequisicaoDetalhe from "./pages/SuprimentosRequisicaoDetalhe";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PermissionRoute({ permKey, children }: { permKey: string; children: React.ReactNode }) {
  const { hasAccess, loading } = usePermissions();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!hasAccess(permKey)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <ShieldX className="h-16 w-16" />
        <h2 className="text-xl font-semibold text-foreground">Acesso Restrito</h2>
        <p>Você não tem permissão para acessar este módulo.</p>
      </div>
    );
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        element={
          <ProtectedRoute>
            <PeriodProvider>
              <AppLayout />
            </PeriodProvider>
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<PermissionRoute permKey="dashboard"><Dashboard /></PermissionRoute>} />
        <Route path="/cash" element={<PermissionRoute permKey="cash"><CashBanks /></PermissionRoute>} />
        <Route path="/receivables" element={<PermissionRoute permKey="receivables"><Receivables /></PermissionRoute>} />
        <Route path="/sales" element={<PermissionRoute permKey="sales"><Sales /></PermissionRoute>} />
        <Route path="/inventory" element={<PermissionRoute permKey="inventory"><Inventory /></PermissionRoute>} />
        <Route path="/inventory/import" element={<PermissionRoute permKey="inventory"><InventoryImport /></PermissionRoute>} />
        <Route path="/inventory/closings" element={<PermissionRoute permKey="inventory"><InventoryClosings /></PermissionRoute>} />
        <Route path="/inventory/counting" element={<PermissionRoute permKey="inventory"><InventoryCounting /></PermissionRoute>} />
        <Route path="/inventory/reports" element={<PermissionRoute permKey="inventory"><InventoryReports /></PermissionRoute>} />
        <Route path="/fixed-assets" element={<Navigate to="/fixed-assets/dashboard" replace />} />
        <Route path="/fixed-assets/dashboard" element={<PermissionRoute permKey="fixed_assets"><FixedAssetsDashboard /></PermissionRoute>} />
        <Route path="/fixed-assets/reconciliation" element={<PermissionRoute permKey="fixed_assets"><FixedAssetsReconciliation /></PermissionRoute>} />
        <Route path="/fixed-assets/items" element={<PermissionRoute permKey="fixed_assets"><FixedAssetsItems /></PermissionRoute>} />
        <Route path="/commodatum" element={<PermissionRoute permKey="commodatum"><Commodatum /></PermissionRoute>} />
        <Route path="/nf-entrada" element={<PermissionRoute permKey="nf_entrada"><NfEntrada /></PermissionRoute>} />
        <Route path="/email-nfe" element={<PermissionRoute permKey="nf_entrada"><EmailNfe /></PermissionRoute>} />
        <Route path="/suprimentos/requisicoes" element={<PermissionRoute permKey="suprimentos_requisicoes"><SuprimentosRequisicoes /></PermissionRoute>} />
        <Route path="/suprimentos/requisicoes/nova" element={<PermissionRoute permKey="suprimentos_requisicoes"><SuprimentosRequisicaoNova /></PermissionRoute>} />
        <Route path="/suprimentos/requisicoes/:id" element={<PermissionRoute permKey="suprimentos_requisicoes"><SuprimentosRequisicaoDetalhe /></PermissionRoute>} />
        <Route path="/compras/notas-fiscais" element={<PermissionRoute permKey="compras"><ComprasNotasFiscais /></PermissionRoute>} />
        <Route path="/compras/notas-servico" element={<PermissionRoute permKey="compras"><ComprasNotasServico /></PermissionRoute>} />
        <Route path="/compras/certificado" element={<PermissionRoute permKey="compras"><ComprasCertificado /></PermissionRoute>} />
        <Route path="/compras/pedidos-compra" element={<PermissionRoute permKey="compras"><ComprasPedidosCompra /></PermissionRoute>} />
        <Route path="/entidades" element={<PermissionRoute permKey="entidades"><Entidades /></PermissionRoute>} />
        <Route path="/entidades/upload-codigos" element={<PermissionRoute permKey="entidades"><EntidadesUploadCodigos /></PermissionRoute>} />
        <Route path="/contas-a-pagar" element={<PermissionRoute permKey="contas_pagar"><ContasPagar /></PermissionRoute>} />
        <Route path="/contas-a-pagar/dashboard" element={<PermissionRoute permKey="contas_pagar"><ContasPagarDashboard /></PermissionRoute>} />
        <Route path="/loans" element={<PermissionRoute permKey="loans"><PlaceholderPage titleKey="nav.loans" /></PermissionRoute>} />
        <Route path="/taxes" element={<PermissionRoute permKey="taxes"><Taxes /></PermissionRoute>} />
        <Route path="/intercompany" element={<PermissionRoute permKey="intercompany"><Intercompany /></PermissionRoute>} />
        <Route path="/credit-cards" element={<PermissionRoute permKey="credit_cards"><CreditCards /></PermissionRoute>} />
        <Route path="/credit-cards/:cardId" element={<PermissionRoute permKey="credit_cards"><CreditCardDetail /></PermissionRoute>} />
        <Route path="/credit-cards/:cardId/invoices/:invoiceId" element={<PermissionRoute permKey="credit_cards"><CreditCardInvoice /></PermissionRoute>} />
        <Route path="/projetos" element={<PermissionRoute permKey="projetos"><Projetos /></PermissionRoute>} />
        <Route path="/projetos/:id" element={<PermissionRoute permKey="projetos"><ProjetoRequisicoes /></PermissionRoute>} />
        <Route path="/closing" element={<PermissionRoute permKey="closing"><Closing /></PermissionRoute>} />
        <Route path="/settings/api" element={<PermissionRoute permKey="settings"><Settings /></PermissionRoute>} />
        <Route path="/settings/cost-centers" element={<PermissionRoute permKey="settings"><CostCenters /></PermissionRoute>} />
        <Route path="/settings/classes-rec-desp" element={<PermissionRoute permKey="settings"><ClassesRecDesp /></PermissionRoute>} />
        <Route path="/settings/users" element={<UsersSettings />} />
        <Route path="/configuracoes/sincronizacoes" element={<ConfigSyncJobs />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
export default App;
