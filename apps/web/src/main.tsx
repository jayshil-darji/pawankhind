import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "@fontsource/bebas-neue/400.css";
import "@fontsource-variable/inter";
import "./index.css";
import ResultPage from "./ResultPage.tsx";
import LandingPage from "./LandingPage.tsx";
import LegalPage from "./LegalPage.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route index element={<LandingPage />} />
        <Route path="registration/:id" element={<ResultPage />} />
        <Route path="terms" element={<LegalPage page="terms" />} />
        <Route path="privacy" element={<LegalPage page="privacy" />} />
        <Route path="refunds" element={<LegalPage page="refunds" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
