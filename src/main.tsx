import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// A tela de Certificado Digital (removida em 15/10/2026) guardava o .pfx e a
// senha no navegador. Apaga o que tiver sobrado em quem chegou a configurar.
try {
  [
    "sefaz_pfx_base64",
    "sefaz_pfx_filename",
    "sefaz_passphrase",
    "sefaz_cnpj",
    "sefaz_cuf_autor",
    "sefaz_tp_amb",
    "sefaz_service_url",
    "sefaz_api_secret",
  ].forEach((k) => localStorage.removeItem(k));
} catch {
  // localStorage indisponível (modo privado etc.) — nada a limpar
}

createRoot(document.getElementById("root")!).render(<App />);
