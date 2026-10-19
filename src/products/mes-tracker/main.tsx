import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { MesTrackerProductApp } from './MesTrackerProductApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MesTrackerProductApp />
  </StrictMode>
);
