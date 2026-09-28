import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/theme.css';
import { App } from './App.jsx';

const container = document.getElementById('root');
if (container === null) throw new Error('missing #root');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
