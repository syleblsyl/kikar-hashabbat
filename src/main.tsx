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

// Secular One draws ₪ like the letters ש״ח; take just that one sign from Assistant
try {
  const f = new FontFace('ShekelSign', `url(${shekelFont})`, { unicodeRange: 'U+20AA', weight: '100 900' });
  document.fonts.add(f);
  f.load().catch(() => undefined);
} catch {
  /* old WebView: falls back to Secular One */
}

if (Capacitor.isNativePlatform()) {
  SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
