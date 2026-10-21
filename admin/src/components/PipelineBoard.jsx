/**
 * Tableau du pipeline (dashboard et ERP) : hauteur fixe, colonnes qui défilent chacune vers le bas,
 * barre de défilement horizontale toujours visible, flèches gauche / droite, glisser le fond du tableau
 * à la souris pour le faire défiler, et défilement automatique quand on amène une carte près d'un bord.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const EDGE = 90; // zone (px) près d'un bord qui fait défiler pendant un glisser-déposer

export default function PipelineBoard({ children }) {
  const ref = useRef(null);
  const pan = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges(e => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(update);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [update]);
  useEffect(update); // le nombre de colonnes peut changer (filtres, étape « perdu »)

  const scrollByPage = dir => {
    const el = ref.current;
    el.scrollBy({ left: dir * Math.max(260, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  const onDragOver = e => {
    const el = ref.current;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left + EDGE) el.scrollLeft -= 20;
    else if (e.clientX > r.right - EDGE) el.scrollLeft += 20;
  };

  // Glisser le fond (pas une carte) avec la souris ; au doigt, le défilement natif suffit
  const onPointerDown = e => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.pipe-card, button, a, input, select, textarea')) return;
    pan.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false };
  };
  const onPointerMove = e => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    if (!p.moved && Math.abs(dx) < 4) return;
    if (!p.moved) { p.moved = true; ref.current.setPointerCapture(e.pointerId); ref.current.classList.add('panning'); }
    ref.current.scrollLeft = p.left - dx;
  };
  const endPan = () => {
    if (!pan.current) return;
    pan.current = null;
    ref.current.classList.remove('panning');
  };

  return (
    <div className="pipeline-wrap">
      {edges.left && (
        <button type="button" className="pipe-nav left" onClick={() => scrollByPage(-1)} aria-label="Étapes précédentes"><ChevronLeft /></button>
      )}
      <div className="pipeline" ref={ref} onScroll={update} onDragOver={onDragOver}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPan} onPointerCancel={endPan}>
        {children}
      </div>
      {edges.right && (
        <button type="button" className="pipe-nav right" onClick={() => scrollByPage(1)} aria-label="Étapes suivantes"><ChevronRight /></button>
      )}
    </div>
  );
}
