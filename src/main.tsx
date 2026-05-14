import { createRoot } from 'react-dom/client'
import { openUrl } from '@tauri-apps/plugin-opener'
import './index.css'
import App from './App.tsx'
import { useUiStore, type ThemeId } from './store/uiStore'

function applyTheme(theme: ThemeId): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
}

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

let currentTheme = useUiStore.getState().theme;
applyTheme(currentTheme);
useUiStore.subscribe((state) => {
  if (state.theme === currentTheme) return;
  currentTheme = state.theme;
  applyTheme(currentTheme);
});

createRoot(document.getElementById('root')!).render(
  <App />,
)
