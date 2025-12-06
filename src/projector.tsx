import React from 'react';
import ReactDOM from 'react-dom/client';
import { ProjectorView } from './components/ProjectorView';
import './projector.css';


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ProjectorView />
  </React.StrictMode>
);

