import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { PlaybookProductApp } from './PlaybookProductApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlaybookProductApp />
  </StrictMode>
);
