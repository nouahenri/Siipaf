import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Plus, Pencil, Trash2, Layers, Map as MapIcon, LandPlot, Ruler, Wallet } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Modal, Drawer, Field, StatusBadge, DistributionBar, naturalCompare } from '@admin/components/ui';
import { LOT_STATUSES, lotStatus } from '@admin/lib/domain';
import { fcfa, num } from '@admin/lib/format';
import { useCommercialMeta, compact, floorLabel } from '../../lib/commercial';
import { NewSale } from './LeadDrawer';

/** Parc immobilier : projet › îlot › bâtiment › étage › lot (appartements, villas, parcelles). */
export default function Property() {
  const { can } = useAuth();
  const meta = useCommercialMeta();
  const [params, setParams] = useSearchParams();
  const projectId = params.get('project_id') || '';
  const [ilot, setIlot] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [selected, setSelected] = useState([]);
  const [editLot, setEditLot] = useState(null);
  const [editBuilding, setEditBuilding] = useState(null);
  const [bulk, setBulk] = useState(false);
  const data = useResource(projectId ? `/admin/erp/commercial/property?project_id=${projectId}` : null);
  const write = can('property:write');

  useEffect(() => {
    if (!projectId && meta?.projects.length) setParams({ project_id: String(meta.projects[0].id) }, { replace: true });
  }, [meta, projectId, setParams]);
  useEffect(() => { setIlot(''); setBuildingId(''); setSelected([]); }, [projectId]);

  const d = data.data;
  const lots = useMemo(() => (d?.lots || []).slice().sort((a, b) => naturalCompare(a.ilot || '', b.ilot || '') || naturalCompare(a.code, b.code)), [d]);
  const ilots = useMemo(() => [...new Set(lots.map(l => l.ilot).filter(Boolean))].sort(naturalCompare), [lots]);
  const buildings = (d?.buildings || []).filter(b => !ilot || b.ilot === ilot);
  const shown = lots.filter(l => (!ilot || l.ilot === ilot) && (!buildingId || (buildingId === 'none' ? !l.building_id : l.building_id === Number(buildingId))));
  const building = buildings.find(b => b.id === Number(buildingId));
  const bName = id => d?.buildings.find(b => b.id === id)?.code;

  return (
    <div className="stack">
      <div className="row-between">
        <select className="select" style={{ width: 'auto' }} value={projectId} onChange={e => setParams({ project_id: e.target.value })} aria-label="Programme">
          {meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {write && <button className="btn" onClick={() => setEditBuilding({ ilot })}><Plus />Bâtiment</button>}
      </div>
      <ErrorBox error={data.error} />
      {!d ? <Skeleton h={300} /> : (
        <>
          <div className="grid grid-4">
            <div className="card kpi"><span className="kpi-label"><LandPlot aria-hidden="true" />Lots</span><span className="kpi-value">{num(d.summary.lots)}</span><span className="kpi-foot">{ilots.length} îlot(s) · {d.buildings.length} bâtiment(s)</span></div>
            <div className="card kpi tint-green"><span className="kpi-label"><MapIcon aria-hidden="true" />Disponibles</span><span className="kpi-value">{num((d.summary.by_status.disponible || 0) + (d.summary.by_status.desistement || 0))}</span><span className="kpi-foot">dont {d.summary.by_status.desistement || 0} désistement(s)</span></div>
            <div className="card kpi tint-blue"><span className="kpi-label"><Wallet aria-hidden="true" />Valeur du stock</span><span className="kpi-value">{compact(d.summary.stock_value_fcfa)}</span><span className="kpi-foot">au prix catalogue (FCFA)</span></div>
            <div className="card kpi tint-amber"><span className="kpi-label"><Ruler aria-hidden="true" />Surface disponible</span><span className="kpi-value">{num(d.summary.stock_surface_m2)} m²</span><span className="kpi-foot">parcelles et logements libres</span></div>
          </div>
          <Card><DistributionBar items={LOT_STATUSES.map(s => ({ ...s, value: d.summary.by_status[s.id] || 0 }))} /></Card>

          <div className="property-layout">
            <Card title="Structure" bodyClass="tree">
              <button className={`tree-item ${!ilot ? 'on' : ''}`} onClick={() => { setIlot(''); setBuildingId(''); }}><Layers aria-hidden="true" />Tout le programme <span className="muted">{lots.length}</span></button>
              {ilots.map(i => (
                <div key={i}>
                  <button className={`tree-item ${ilot === i && !buildingId ? 'on' : ''}`} onClick={() => { setIlot(i); setBuildingId(''); }}><MapIcon aria-hidden="true" />Îlot {i} <span className="muted">{lots.filter(l => l.ilot === i).length}</span></button>
                  {d.buildings.filter(b => b.ilot === i).map(b => (
                    <button key={b.id} className={`tree-item sub ${buildingId === String(b.id) ? 'on' : ''}`} onClick={() => { setIlot(i); setBuildingId(String(b.id)); }}><Building2 aria-hidden="true" />{b.code} <span className="muted">{lots.filter(l => l.building_id === b.id).length}</span></button>
                  ))}
                </div>
              ))}
              {d.buildings.filter(b => !b.ilot).map(b => (
                <button key={b.id} className={`tree-item ${buildingId === String(b.id) ? 'on' : ''}`} onClick={() => { setIlot(''); setBuildingId(String(b.id)); }}><Building2 aria-hidden="true" />{b.code} <span className="muted">{lots.filter(l => l.building_id === b.id).length}</span></button>
              ))}
              {d.buildings.length > 0 && <button className={`tree-item ${buildingId === 'none' ? 'on' : ''}`} onClick={() => setBuildingId('none')}><LandPlot aria-hidden="true" />Hors bâtiment <span className="muted">{lots.filter(l => !l.building_id && (!ilot || l.ilot === ilot)).length}</span></button>}
            </Card>

            <div className="stack" style={{ minWidth: 0 }}>
              {building && (
                <Card title={`${building.code}${building.name ? ` — ${building.name}` : ''}`} actions={write && (
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setEditBuilding(building)} aria-label="Modifier le bâtiment"><Pencil /></button>
                    <DeleteBuilding building={building} onDone={() => { setBuildingId(''); data.reload(); }} />
                  </span>
                )}>
                  <p className="small muted" style={{ marginBottom: 12 }}>{meta?.building_kinds[building.kind]} · R+{building.floors}{building.ilot ? ` · îlot ${building.ilot}` : ''}</p>
                  <div className="floors">
                    {Array.from({ length: building.floors + 1 }, (_, k) => building.floors - k).map(f => {
                      const fl = shown.filter(l => l.floor === f);
                      return (
                        <div key={f} className="floor">
                          <span className="floor-label small">{floorLabel(f)}</span>
                          <div className="floor-lots">
                            {fl.length ? fl.map(l => (
                              <button key={l.id} className="unit" style={{ '--c': lotStatus(l.status).color }} onClick={() => setEditLot(l)} title={`${lotStatus(l.status).label}${l.buyer_name ? ` — ${l.buyer_name}` : ''}`}>
                                <b>{l.code}</b><span>{l.lot_type ? meta?.lot_types[l.lot_type] : ''}{l.rooms ? ` · ${l.rooms} p.` : ''}</span>
                              </button>
                            )) : <span className="muted small">—</span>}
                          </div>
                        </div>
                      );
                    })}
                    {shown.some(l => l.floor == null) && <p className="small muted">{shown.filter(l => l.floor == null).length} lot(s) sans étage renseigné.</p>}
                  </div>
                </Card>
              )}

              <Card bodyClass="" title={`${shown.length} lot(s)`} actions={write && selected.length > 0 && <button className="btn btn-sm btn-primary" onClick={() => setBulk(true)}>Affecter {selected.length} lot(s)</button>}>
                {!shown.length ? <div className="card-body"><Empty icon={LandPlot}>Aucun lot ici.</Empty></div> : (
                  <div className="table-wrap"><table className="table">
                    <thead><tr>
                      {write && <th><input type="checkbox" aria-label="Tout sélectionner" checked={selected.length === shown.length} onChange={e => setSelected(e.target.checked ? shown.map(l => l.id) : [])} /></th>}
                      <th>Lot</th><th>Type</th><th>Bâtiment · étage</th><th className="right">Surface</th><th className="right">Prix</th><th>Statut</th><th>Acquéreur</th>
                    </tr></thead>
                    <tbody>
                      {shown.map(l => (
                        <tr key={l.id} className="clickable" onClick={() => setEditLot(l)}>
                          {write && <td onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Sélectionner le lot ${l.code}`} checked={selected.includes(l.id)} onChange={e => setSelected(s => (e.target.checked ? [...s, l.id] : s.filter(x => x !== l.id)))} /></td>}
                          <td><b>{l.code}</b>{l.ilot && <div className="small muted">îlot {l.ilot}</div>}</td>
                          <td className="small">{l.lot_type ? meta?.lot_types[l.lot_type] : <span className="muted">—</span>}{l.rooms ? ` · ${l.rooms} p.` : ''}</td>
                          <td className="small">{l.building_id ? `${bName(l.building_id)} · ${floorLabel(l.floor)}` : <span className="muted">—</span>}</td>
                          <td className="right tabular small">{l.surface_m2 ? `${num(l.surface_m2)} m²` : '—'}</td>
                          <td className="right tabular small">{l.price_fcfa ? compact(l.price_fcfa) : '—'}</td>
                          <td><StatusBadge status={l.status} /></td>
                          <td className="small">{l.buyer_name || <span className="muted">—</span>}{l.vefa && <span className="muted"> · VEFA</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
      {editLot && <LotEditor lot={editLot} buildings={d?.buildings || []} write={write} onClose={() => setEditLot(null)} onSaved={() => { setEditLot(null); data.reload(); }} />}
      {editBuilding && <BuildingModal projectId={projectId} building={editBuilding} ilots={ilots} onClose={() => setEditBuilding(null)} onSaved={() => { setEditBuilding(null); data.reload(); }} />}
      {bulk && <BulkModal lotIds={selected} buildings={d?.buildings || []} onClose={() => setBulk(false)} onSaved={() => { setBulk(false); setSelected([]); data.reload(); }} />}
    </div>
  );
}

function DeleteBuilding({ building, onDone }) {
  const toast = useToast();
  const del = async () => {
    if (!window.confirm(`Supprimer ${building.code} ? Les lots restent, sans bâtiment.`)) return;
    try { await api.del(`/admin/erp/commercial/buildings/${building.id}`); toast('Bâtiment supprimé'); onDone(); } catch (e) { toast(e.message, 'err'); }
  };
  return <button className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={del} aria-label="Supprimer le bâtiment"><Trash2 /></button>;
}

function BuildingModal({ projectId, building, ilots, onClose, onSaved }) {
  const meta = useCommercialMeta();
  const [f, setF] = useState({ code: building.code || '', name: building.name || '', ilot: building.ilot || '', kind: building.kind || 'immeuble', floors: building.floors ?? 0, notes: building.notes || '' });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async e => {
    e.preventDefault(); setError(null);
    const body = { code: f.code, name: f.name || null, ilot: f.ilot || null, kind: f.kind, floors: Number(f.floors) || 0, notes: f.notes || null };
    try {
      if (building.id) await api.patch(`/admin/erp/commercial/buildings/${building.id}`, body);
      else await api.post(`/admin/erp/commercial/projects/${projectId}/buildings`, body);
      onSaved();
    } catch (err) { setError(err); }
  };
  return (
    <Modal title={building.id ? `Modifier ${building.code}` : 'Nouveau bâtiment'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="bld">Enregistrer</button></>}>
      <form id="bld" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Code"><input className="input" required maxLength={40} value={f.code} onChange={set('code')} placeholder="Bât. A" autoFocus /></Field>
        <Field label="Nom (facultatif)"><input className="input" maxLength={160} value={f.name} onChange={set('name')} placeholder="Résidence Les Palmiers" /></Field>
        <Field label="Îlot">
          <select className="select" value={f.ilot} onChange={set('ilot')}>
            <option value="">—</option>
            {ilots.map(i => <option key={i} value={i}>Îlot {i}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select className="select" value={f.kind} onChange={set('kind')}>
            {meta && Object.entries(meta.building_kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Étages au-dessus du rez-de-chaussée" hint="0 = plain-pied, 4 = R+4"><input className="input" type="number" min="0" max="60" value={f.floors} onChange={set('floors')} /></Field>
        <Field label="Notes" className="full"><input className="input" maxLength={500} value={f.notes} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}

function LotEditor({ lot, buildings, write, onClose, onSaved }) {
  const { can } = useAuth();
  const meta = useCommercialMeta();
  const [f, setF] = useState({
    lot_type: lot.lot_type || '', building_id: lot.building_id || '', floor: lot.floor ?? '', rooms: lot.rooms ?? '',
    surface_m2: lot.surface_m2 ?? '', price_fcfa: lot.price_fcfa ?? '', title_number: lot.title_number || '', tantiemes: lot.tantiemes ?? '',
  });
  const [error, setError] = useState(null);
  const [selling, setSelling] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const n = v => (v === '' ? null : Number(v));
  const b = buildings.find(x => x.id === Number(f.building_id));
  const save = async e => {
    e.preventDefault(); setError(null);
    try {
      await api.patch(`/admin/erp/commercial/lots/${lot.id}`, {
        lot_type: f.lot_type || null, building_id: n(f.building_id), floor: f.building_id ? n(f.floor) : null, rooms: n(f.rooms),
        surface_m2: n(f.surface_m2), price_fcfa: n(f.price_fcfa), title_number: f.title_number || null, tantiemes: n(f.tantiemes),
      });
      onSaved();
    } catch (err) { setError(err); }
  };
  const free = ['disponible', 'desistement', 'option'].includes(lot.status);
  return (
    <Drawer title={`Lot ${lot.code}${lot.ilot ? ` · îlot ${lot.ilot}` : ''}`} onClose={onClose}
      footer={write && <button className="btn btn-primary" form="lot-edit">Enregistrer</button>}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 8 }}><StatusBadge status={lot.status} />{lot.buyer_name && <span className="small">Acquéreur : <b>{lot.buyer_name}</b>{lot.vefa ? ' (VEFA)' : ''}</span>}</div>
        {free && can('sales:write') && <LeadPicker onPick={lead => setSelling(lead)} />}
        <ErrorBox error={error} />
        <form id="lot-edit" onSubmit={save}>
          <fieldset disabled={!write} className="form-grid">
            <Field label="Type de bien">
              <select className="select" value={f.lot_type} onChange={set('lot_type')}>
                <option value="">—</option>
                {meta && Object.entries(meta.lot_types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Pièces"><input className="input" type="number" min="0" max="30" value={f.rooms} onChange={set('rooms')} /></Field>
            <Field label="Bâtiment">
              <select className="select" value={f.building_id} onChange={set('building_id')}>
                <option value="">— Aucun (parcelle, villa isolée) —</option>
                {buildings.map(x => <option key={x.id} value={x.id}>{x.code}{x.ilot ? ` (îlot ${x.ilot})` : ''}</option>)}
              </select>
            </Field>
            <Field label="Étage">
              <select className="select" value={f.floor} onChange={set('floor')} disabled={!b}>
                <option value="">—</option>
                {b && Array.from({ length: b.floors + 1 }, (_, k) => k).map(k => <option key={k} value={k}>{floorLabel(k)}</option>)}
              </select>
            </Field>
            <Field label="Surface (m²)"><input className="input" type="number" min="0" step="0.01" value={f.surface_m2} onChange={set('surface_m2')} /></Field>
            <Field label="Prix catalogue (FCFA)" hint={f.price_fcfa ? fcfa(f.price_fcfa) : undefined}><input className="input" type="number" min="0" step="1000" value={f.price_fcfa} onChange={set('price_fcfa')} /></Field>
            <Field label="Titre foncier / ACD"><input className="input" maxLength={80} value={f.title_number} onChange={set('title_number')} placeholder="TF n° …" /></Field>
            <Field label="Tantièmes" hint="Copropriété : quote-part des parties communes"><input className="input" type="number" min="0" value={f.tantiemes} onChange={set('tantiemes')} /></Field>
          </fieldset>
        </form>
      </div>
      {selling && <NewSale lead={selling} lot={{ id: lot.id, project_id: null, code: lot.code, price_fcfa: lot.price_fcfa, surface_m2: lot.surface_m2 }} onClose={() => setSelling(null)} onDone={() => { setSelling(null); onSaved(); }} />}
    </Drawer>
  );
}

/** Choix d'un prospect pour ouvrir une vente sur ce lot. */
function LeadPicker({ onPick }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return undefined; }
    const t = setTimeout(() => api.get(`/admin/erp/commercial/pipeline?q=${encodeURIComponent(q)}`).then(r => setRows(r.slice(0, 6))).catch(() => setRows([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="erp-panel stack" style={{ gap: 8 }}>
      <b className="small">Vendre ce lot à…</b>
      <input className="input" type="search" placeholder="Nom ou téléphone du prospect" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un prospect" />
      {rows.length > 0 && (
        <ul className="pick-list">
          {rows.map(r => <li key={r.id}><button type="button" onClick={() => onPick(r)}><b>{r.name}</b> <span className="small muted">{r.phone || ''} · {r.project_name || '—'}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

function BulkModal({ lotIds, buildings, onClose, onSaved }) {
  const meta = useCommercialMeta();
  const [f, setF] = useState({ lot_type: '', building_id: '', floor: '' });
  const [error, setError] = useState(null);
  const b = buildings.find(x => x.id === Number(f.building_id));
  const save = async () => {
    const body = { lot_ids: lotIds };
    if (f.lot_type) body.lot_type = f.lot_type;
    if (f.building_id === 'none') body.building_id = null;
    else if (f.building_id) { body.building_id = Number(f.building_id); if (f.floor !== '') body.floor = Number(f.floor); }
    try { await api.post('/admin/erp/commercial/lots/bulk', body); onSaved(); } catch (e) { setError(e); }
  };
  return (
    <Modal title={`Affecter ${lotIds.length} lot(s)`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Appliquer</button></>}>
      <div className="form-grid">
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Type de bien">
          <select className="select" value={f.lot_type} onChange={e => setF(x => ({ ...x, lot_type: e.target.value }))}>
            <option value="">— Inchangé —</option>
            {meta && Object.entries(meta.lot_types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Bâtiment">
          <select className="select" value={f.building_id} onChange={e => setF(x => ({ ...x, building_id: e.target.value, floor: '' }))}>
            <option value="">— Inchangé —</option>
            <option value="none">Retirer du bâtiment</option>
            {buildings.map(x => <option key={x.id} value={x.id}>{x.code}</option>)}
          </select>
        </Field>
        {b && (
          <Field label="Étage">
            <select className="select" value={f.floor} onChange={e => setF(x => ({ ...x, floor: e.target.value }))}>
              <option value="">— Inchangé —</option>
              {Array.from({ length: b.floors + 1 }, (_, k) => k).map(k => <option key={k} value={k}>{floorLabel(k)}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
