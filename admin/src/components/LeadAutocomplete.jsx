import { useEffect, useId, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/app-context';

/** Recherche les prospects et clients par nom, sans confondre les homonymes. */
export default function LeadAutocomplete({ value, selectedId, onChange, onSelect }) {
  const { can } = useAuth();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [search, setSearch] = useState({ query: '', rows: [], loading: false, error: false });
  const query = value.trim();
  const allowed = can('leads:read');
  const show = open && allowed && !selectedId && query.length >= 2;
  const rows = search.query === query ? search.rows : [];

  useEffect(() => {
    if (!allowed || selectedId || query.length < 2) return;
    let current = true;
    setSearch({ query, rows: [], loading: true, error: false });
    setActive(-1);
    const timer = setTimeout(() => {
      api.get(`/admin/leads?q=${encodeURIComponent(query)}&limit=8`).then(data => {
        if (current) setSearch({ query, rows: data.rows, loading: false, error: false });
      }).catch(() => {
        if (current) setSearch({ query, rows: [], loading: false, error: true });
      });
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [query, selectedId, allowed]);

  const select = lead => { onSelect(lead); setOpen(false); };
  const keyDown = e => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (rows.length) setActive(i => e.key === 'ArrowDown' ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && show && rows[active]) { e.preventDefault(); select(rows[active]); }
  };

  return <div className="field full lead-lookup" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <span><label htmlFor={`${id}-input`}>Nom de l’acquéreur</label></span>
    <input id={`${id}-input`} className="input" role="combobox" autoComplete="off"
      value={value} onChange={e => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={keyDown}
      aria-autocomplete="list" aria-expanded={show} aria-controls={`${id}-list`} aria-describedby={`${id}-help`}
      aria-activedescendant={show && rows[active] ? `${id}-option-${rows[active].id}` : undefined} />
    <small id={`${id}-help`}>{selectedId ? 'Fiche existante sélectionnée. Modifiez le nom pour choisir une autre personne.' : allowed ? 'Saisissez au moins 2 caractères pour rechercher un prospect ou un client, ou créez un nouvel acquéreur.' : 'Renseignez le nom et les coordonnées du nouvel acquéreur.'}</small>
    {show && <div className="lead-results">
      <ul id={`${id}-list`} role="listbox" aria-label="Prospects et clients existants">
        {rows.map((lead, i) => <li key={lead.id} role="presentation">
          <button type="button" id={`${id}-option-${lead.id}`} role="option" aria-selected={active === i} tabIndex={-1}
            onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => select(lead)}>
            <span className="row-between"><strong>{lead.name}</strong><span className="badge">{lead.client_code ? 'Client' : 'Prospect'}</span></span>
            <span className="small muted">{[lead.client_code, lead.phone, lead.email].filter(Boolean).join(' · ') || 'Aucune coordonnée renseignée'}</span>
          </button>
        </li>)}
      </ul>
      {!rows.length && <p className="small muted" role="status">{search.query !== query || search.loading ? 'Recherche…' : search.error ? 'Recherche indisponible. La saisie manuelle reste possible.' : 'Aucun résultat. Vous pouvez renseigner un nouvel acquéreur.'}</p>}
    </div>}
  </div>;
}
