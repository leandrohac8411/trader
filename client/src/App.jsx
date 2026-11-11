import React, { lazy, Suspense, useEffect, useState } from "react";

const Office = lazy(() => import('./office3d/Office.jsx'));
// Dashboard clássico só carrega quando aberto (o escritório é a página inicial).
const Dashboard = lazy(() => import('./Dashboard.jsx'));

export default function App() {
  const [page,setPage] = useState(() => window.location.hash === '#dashboard' ? 'dashboard' : 'office');
  useEffect(() => {
    const change = () => setPage(window.location.hash === '#dashboard' ? 'dashboard' : 'office');
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const navigate = (next) => { window.location.hash = next; setPage(next); };
  if (page === 'office') return <Suspense fallback={<div style={{background:'#101820',color:'#e6ad63',minHeight:'100vh',display:'grid',placeItems:'center'}}>Abrindo seu escritório…</div>}><Office onDashboard={() => navigate('dashboard')}/></Suspense>;
  return <><Suspense fallback={null}><Dashboard/></Suspense><button className="classic-office-link" style={{position:'fixed',zIndex:100,right:20,bottom:20,border:'1px solid #d0ac77',borderRadius:30,background:'#172630',color:'#ecd2ac',padding:'12px 20px'}} onClick={() => navigate('office')}>Voltar ao escritório ↗</button></>;
}

