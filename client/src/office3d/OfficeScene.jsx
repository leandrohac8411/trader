import { useEffect, useRef, useState } from 'react';
import { createOfficeScene } from './createOfficeScene.js';
import { Ficha } from './GameUI.jsx';
import { CAMERA_FICHA } from './fichas.js';

export default function OfficeScene({ agents, snapshot, selected, onSelect, reduced, sceneRef, onCamera, theme = 'night' }) {
  const host = useRef(null), labels = useRef({}), current = useRef({ onSelect, onCamera });
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [cam, setCam] = useState(null);
  useEffect(() => { current.current = { onSelect, onCamera }; }, [onSelect, onCamera]);
  useEffect(() => {
    let scene;
    try {
      scene = createOfficeScene(host.current, {
        theme,
        onSelect: id => current.current.onSelect(id),
        onReady: () => setReady(true),
        onError: setError,
        onCamera: info => { setCam(info); current.current.onCamera?.(info); },
        onProject: points => points.forEach(p => {
          const el = labels.current[p.id];
          if (!el) return;
          el.style.left = `${p.x}%`;
          el.style.top = `${p.y}%`;
          // While a character talks, its nameplate hides so the speech bubble stays readable.
          el.style.visibility = p.hidden || p.talking ? 'hidden' : 'visible';
        }),
      });
      sceneRef.current = scene;
      if (import.meta.env.DEV) window.__officeScene = scene; // debug/screenshots only
    } catch {
      setError('Seu navegador não conseguiu abrir a cena 3D. Os agentes continuam disponíveis no painel e na lista abaixo.');
    }
    return () => { scene?.dispose(); sceneRef.current = null; };
  }, [sceneRef, theme]);
  useEffect(() => { sceneRef.current?.update(snapshot, selected); }, [snapshot, selected, sceneRef, theme]);
  useEffect(() => { sceneRef.current?.motion(!reduced); }, [reduced, sceneRef]);
  const stateLabel = a => a.id === 'trader' && snapshot?.crew?.trader?.cooldown ? 'No lounge' : a.state === 'working' ? 'Em consulta' : a.state === 'monitoring' ? 'Monitorando' : a.state === 'error' ? 'Falha' : a.role;
  const fichaId = CAMERA_FICHA[cam?.id];
  const fichaAgent = agents.find(a => a.id === fichaId);
  return <div className="office-scene-wrap">
    <div className="office-scene" ref={host} />
    {!ready && !error && <div className="scene-message">Montando seu escritório…</div>}
    {error && <div className="scene-message scene-error" role="alert">{error}</div>}
    {ready && !error && cam && <div className="scene-cam-hud" aria-live="polite">
      <i className={cam.tour ? 'is-rec' : ''} />{cam.index ? `CAM ${String(cam.index).padStart(2, '0')} · ` : ''}{cam.label}
    </div>}
    {ready && !error && fichaId && <div className="scene-ficha" key={fichaId}><Ficha id={fichaId} name={fichaAgent?.name} color={fichaAgent?.color} snapshot={snapshot} /></div>}
    {ready && !error && <div className="office-nameplates" aria-label="Selecionar funcionário">
      {agents.map(a => <button key={a.id} ref={el => { labels.current[a.id] = el; }} onClick={() => onSelect(a.id)}
        className={`office-nameplate ${selected === a.id ? 'is-selected' : ''}`} style={{ '--agent-color': a.color }} aria-pressed={selected === a.id}>
        <i className={a.state === 'working' ? 'is-working' : ''} />{a.name}<span>{stateLabel(a)}</span>
      </button>)}
    </div>}
    <div className="scene-caption"><span className="floor-mark">COBERTURA</span><span className="caption-desktop">Arraste para girar · role para aproximar · clique em alguém</span><span className="caption-touch">1 dedo rola a página · 2 dedos giram e aproximam · toque em alguém</span></div>
  </div>;
}
