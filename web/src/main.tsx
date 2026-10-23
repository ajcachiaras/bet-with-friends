import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth';
import './push'; // starts listening for the browser's install prompt right away
import './styles.css';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker not registered:', err));
  // Tapping a notification while the app is already open lands here.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'open-route') window.location.hash = event.data.route;
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
);
