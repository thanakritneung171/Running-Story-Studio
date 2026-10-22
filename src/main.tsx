import React from 'react';
import ReactDOM from 'react-dom/client';
import './lib/render/fonts';
import './index.css';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
