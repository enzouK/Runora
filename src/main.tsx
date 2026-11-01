import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { StorageService } from './services/storage';
import './index.css';

// Initialize theme before render to avoid flash
const initTheme = () => {
  const theme = StorageService.getTheme();
  const root = document.documentElement;
  if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  // Color theme (OpenCode palettes) — applied via [data-color-theme] CSS blocks
  root.dataset.colorTheme = StorageService.getColorTheme();
};

initTheme();
// Listen for system theme changes when theme is 'system'
if (StorageService.getTheme() === 'system') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', initTheme);
}

createRoot(document.getElementById('root')!).render(<App />);

// Fade out the static splash screen declared in index.html once React has
// mounted on top of it (double rAF guarantees the first commit painted).
const splash = document.getElementById('splash');
if (splash) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      splash.classList.add('done');
      splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    })
  );
}
