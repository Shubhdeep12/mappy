/**
 * Frontend Entry Point
 * 
 * Initializes React application, renders root component.
 * Sets up routing, global styles, and error boundaries.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
