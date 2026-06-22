import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { App } from './App';
import { AlertsPage } from './pages/Alerts';
import { AuditPage } from './pages/Audit';
import { CertPage } from './pages/Cert';
import { EventsPage } from './pages/Events';
import { HealthPage } from './pages/Health';
import { IssuesPage } from './pages/Issues';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { SettingsPage } from './pages/Settings';
import Tokens from './pages/Tokens';

import './styles/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<App />}>
          <Route index element={<OverviewPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="/projects/:id/issues" element={<IssuesPage />} />
          <Route path="/projects/:id/events" element={<EventsPage />} />
          <Route path="/projects/:id/cert" element={<CertPage />} />
          <Route path="/projects/:id/tokens" element={<Tokens />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
