import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { AppStateProvider } from './state/AppState';
import { ToastProvider } from './components/ui/toast';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <React.StrictMode>
    <ToastProvider>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </ToastProvider>
  </React.StrictMode>,
);
