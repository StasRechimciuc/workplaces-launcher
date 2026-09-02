import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

// window.d.ts (global Window.api typing) needs no import — TypeScript
// picks up ambient .d.ts files automatically from tsconfig's `include`.

const container = document.getElementById('root');
if (!container) {
  throw new Error('Expected #root to exist in the DOM.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
