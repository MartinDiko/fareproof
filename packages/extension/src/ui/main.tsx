import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App view={document.documentElement.dataset.view ?? 'sidepanel'} /></StrictMode>);