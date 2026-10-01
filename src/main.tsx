import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import '@fontsource/assistant/400.css';
import '@fontsource/assistant/600.css';
import '@fontsource/assistant/700.css';
import '@fontsource/assistant/800.css';
import '@fontsource/secular-one/400.css';
import './styles.css';
import shekelFont from '@fontsource/assistant/files/assistant-hebrew-700-normal.woff2?url';
import App from './App';

// Secular One draws ₪ like the letters ש״ח; take just that one sign from Assistant.
// A real @font-face rule (not the FontFace API) so pictures and PDFs made from the screen get it too.
const shekelStyle = document.createElement('style');
shekelStyle.textContent = `@font-face { font-family: 'ShekelSign'; font-weight: 100 900; font-display: swap; src: url(${shekelFont}) format('woff2'); unicode-range: U+20AA; }`;
document.head.appendChild(shekelStyle);

if (Capacitor.isNativePlatform()) {
  SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
