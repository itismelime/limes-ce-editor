import { createRoot } from 'react-dom/client'
import { openUrl } from '@tauri-apps/plugin-opener'
import './index.css'
import App from './App.tsx'

// Redirect all external link clicks to the system browser instead of
// navigating inside the WebView, which would turn the app into a browser.
document.addEventListener('click', (e) => {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href || !/^https?:\/\//.test(href)) return;
  e.preventDefault();
  openUrl(href);
}, true);

createRoot(document.getElementById('root')!).render(
  <App />,
)
