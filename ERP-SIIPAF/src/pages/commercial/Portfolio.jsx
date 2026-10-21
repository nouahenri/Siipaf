/**
 * Objectifs et performance › prospects et clients rattachés à chaque commercial, par semaine, mois, trimestre ou
 * année — brut, pertes, net et cumul — et bilan des listes de prospects importées.
 */
import { useMemo, useState } from 'react';
import { Users, UserCheck, UserMinus, TrendingUp, Inbox, FileSpreadsheet } from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';
import { qs } from '@admin/lib/api';
import { Card, Badge, Empty, ErrorBox, Skeleton, Drawer } from '@admin/components/ui';
import { LineChart } from '@admin/components/Charts';
import { GroupedBars } from '@admin/components/ChartsPlus';
import { date, num } from '@admin/lib/format';
import { stageLabel } from '@admin/lib/domain';

const GRAINS = [['semaine', 'Semaine'], ['mois', 'Mois'], ['trimestre', 'Trimestre'], ['annee', 'Année']];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function preset(id) {
  const now = new Date(), y = now.getFullYear();
  if (id === '12m') return { du: iso(new Date(y, now.getMonth() - 11, 1)), au: iso(now) };
  if (id === 'last') return { du: `${y - 1}-01-01`, au: `${y - 1}-12-31` };
  if (id === '3y') return { du: `${y - 2}-01-01`, au: iso(now) };
  return { du: `${y}-01-01`, au: iso(now) };
}
const signed = n => (n > 0 ? `+${num(n)}` : num(n));
const OUTCOMES = { en_cours: ['En cours', ''], client: ['Client', 'ok'], perdu: ['Perdu', 'danger'], desiste: ['Désisté', 'warn'], supprime: ['Supprimé', 'danger'] };

export function PortfolioCounters() {
  const { can } = useAuth();
  const [grain, setGrain] = useState('mois');
  const [range, setRange] = useState('year');
  const [custom, setCustom] = useState(preset('year'));
  const [seller, setSeller] = useState('');
  const dates = range === 'custom' ? custom : preset(range);
  const res = useResource(`/admin/portefeuille${qs({ granularite: grain, du: dates.du, au: dates.au, commercial: seller })}`);
  const sellers = useResource(can('leads:all') ? '/admin/users/commerciaux' : null);
  const d = res.data;

  // Série affichée : le commercial choisi, sinon l'équipe
  const focus = d && (seller ? d.rows.find(r => String(r.user_id) === String(seller)) : null);
  const series = useMemo(() => (d ? (focus ? focus.series : d.team.series).map(p => ({
    key: p.key, label: p.label, title: p.title,
    recus: p.prospects.brut, sorties: p.prospects.pertes + p.prospects.transferes, clients: p.clients.net,
    cumulP: p.cumul?.prospects, cumulC: p.cumul?.clients,
  })) : []), [d, focus]);
  const cumul = useMemo(() => {
    if (focus || !d) return series;
    // Équipe : cumul recalculé à partir des séries de chaque commercial
    return series.map((p, i) => ({ ...p, cumulP: d.rows.reduce((t, r) => t + r.series[i].cumul.prospects, 0), cumulC: d.rows.reduce((t, r) => t + r.series[i].cumul.clients, 0) }));
  }, [series, focus, d]);
  const labels = Object.fromEntries(series.map(p => [p.key, p]));
  const total = d ? (focus ? focus.total : d.team.total) : null;

  return (
    <>
      <div className="row-between">
        <div className="row">
          <div className="seg" role="tablist" aria-label="Découpage">
            {GRAINS.map(([k, l]) => <button key={k} className={grain === k ? 'active' : ''} onClick={() => setGrain(k)}>{l}</button>)}
          </div>
          <select className="select" style={{ width: 'auto' }} value={range} onChange={e => setRange(e.target.value)} aria-label="Période">
            <option value="year">Cette année</option>
            <option value="12m">12 derniers mois</option>
            <option value="last">L’année dernière</option>
            <option value="3y">3 ans</option>
            <option value="custom">Dates libres</option>
          </select>
          {range === 'custom' && (
            <>
              <input className="input" style={{ width: 'auto' }} type="date" value={custom.du} max={custom.au} onChange={e => setCustom(c => ({ ...c, du: e.target.value }))} aria-label="Du" />
              <input className="input" style={{ width: 'auto' }} type="date" value={custom.au} min={custom.du} onChange={e => setCustom(c => ({ ...c, au: e.target.value }))} aria-label="Au" />
            </>
          )}
        </div>
        {can('leads:all') && (
          <select className="select" style={{ width: 'auto' }} value={seller} onChange={e => setSeller(e.target.value)} aria-label="Commercial">
            <option value="">Toute l’équipe</option>
            {sellers.data?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>
      <ErrorBox error={res.error} />
      {!d ? <Skeleton h={320} /> : (
        <>
          <div className="grid grid-4">
            <div className="card kpi tint-blue">
              <span className="kpi-label"><Users aria-hidden="true" />Prospects attribués</span>
              <span className="kpi-value">{num(total.prospects.brut)}</span>
              <span className="kpi-foot">brut, sur la période</span>
            </div>
            <div className="card kpi tint-amber">
              <span className="kpi-label"><UserMinus aria-hidden="true" />Pertes et transferts</span>
              <span className="kpi-value">{num(total.prospects.pertes + total.prospects.transferes)}</span>
              <span className="kpi-foot">{num(total.prospects.pertes)} perdus ou supprimés · {num(total.prospects.transferes)} transférés</span>
            </div>
            <div className="card kpi tint-violet">
              <span className="kpi-label"><TrendingUp aria-hidden="true" />Prospects nets</span>
              <span className="kpi-value">{signed(total.prospects.net)}</span>
              <span className="kpi-foot">attribués − pertes − transferts</span>
            </div>
            <div className="card kpi tint-green">
              <span className="kpi-label"><UserCheck aria-hidden="true" />Clients nets</span>
              <span className="kpi-value">{signed(total.clients.net)}</span>
              <span className="kpi-foot">{num(total.clients.brut)} gagnés · {num(total.clients.desistes)} désistés</span>
            </div>
          </div>
          {d.unassigned > 0 && (
            <div className="alert alert-info"><Inbox size={16} aria-hidden="true" />{num(d.unassigned)} prospect(s) en cours sans commercial attribué. À répartir depuis le dashboard (Prospects › Non attribués).</div>
          )}

          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <Card title={`Par ${GRAINS.find(g => g[0] === grain)[1].toLowerCase()}`} actions={<span className="small muted">{focus ? focus.name : 'Équipe'}</span>}>
              <GroupedBars
                data={series} format={v => num(v)} labelOf={(p, long) => (long ? p.title : grain === 'mois' && series.length > 6 ? p.label.split(' ')[0] : p.label)}
                series={[
                  { key: 'recus', label: 'Prospects attribués', color: 'var(--series-1)' },
                  { key: 'sorties', label: 'Pertes et transferts', color: 'var(--series-2)' },
                  { key: 'clients', label: 'Clients nets', color: 'var(--series-3)' },
                ]}
                ariaLabel="Prospects attribués, pertes et clients nets par période"
              />
            </Card>
            <Card title="Cumul" actions={<span className="small muted">net, depuis le début</span>}>
              <LineChart
                data={cumul} xKey="key" format={v => num(v)} labelOf={k => labels[k]?.label || k} titleOf={k => labels[k]?.title || k}
                series={[{ key: 'cumulP', label: 'Prospects nets cumulés', color: 'var(--series-1)' }, { key: 'cumulC', label: 'Clients nets cumulés', color: 'var(--series-3)' }]}
                ariaLabel="Cumul des prospects nets et des clients nets"
              />
            </Card>
          </div>

          {!d.mine_only && !seller && (
            <Card title="Par commercial" bodyClass="">
              {!d.rows.length ? <Empty icon={Users}>Aucun commercial.</Empty> : (
                <div className="table-wrap"><table className="table">
                  <thead>
                    <tr><th rowSpan={2}>Commercial</th><th colSpan={4} className="center">Prospects</th><th colSpan={3} className="center">Clients</th><th colSpan={2} className="center">Portefeuille actuel</th></tr>
                    <tr><th className="right">Attribués</th><th className="right">Transférés</th><th className="right">Pertes</th><th className="right">Net</th><th className="right">Gagnés</th><th className="right">Désistés</th><th className="right">Net</th><th className="right">Prospects</th><th className="right">Clients</th></tr>
                  </thead>
                  <tbody>{d.rows.map(r => (
                    <tr key={r.user_id} className="clickable" onClick={() => setSeller(String(r.user_id))}>
                      <td><strong>{r.name}</strong>{!r.active && <> <Badge>Désactivé</Badge></>}</td>
                      <td className="right tabular">{num(r.total.prospects.brut)}</td>
                      <td className="right tabular">{num(r.total.prospects.transferes)}</td>
                      <td className="right tabular">{num(r.total.prospects.pertes)}</td>
                      <td className="right tabular"><strong>{signed(r.total.prospects.net)}</strong></td>
                      <td className="right tabular">{num(r.total.clients.brut)}</td>
                      <td className="right tabular">{num(r.total.clients.desistes)}</td>
                      <td className="right tabular"><strong>{signed(r.total.clients.net)}</strong></td>
                      <td className="right tabular">{num(r.current.prospects)}</td>
                      <td className="right tabular">{num(r.current.clients)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </Card>
          )}

          <Card title={`Détail par période · ${focus ? focus.name : d.mine_only && d.rows[0] ? d.rows[0].name : 'équipe'}`} bodyClass="">
            <div className="table-wrap"><table className="table">
              <thead>
                <tr><th rowSpan={2}>Période</th><th colSpan={5} className="center">Prospects</th><th colSpan={4} className="center">Clients</th></tr>
                <tr><th className="right">Attribués</th><th className="right">Transférés</th><th className="right">Pertes</th><th className="right">Net</th><th className="right">Cumul</th><th className="right">Gagnés</th><th className="right">Désistés</th><th className="right">Net</th><th className="right">Cumul</th></tr>
              </thead>
              <tbody>{(focus ? focus.series : d.team.series).map((p, i) => (
                <tr key={p.key}>
                  <td className="nowrap">{p.title}</td>
                  <td className="right tabular">{num(p.prospects.brut)}</td>
                  <td className="right tabular">{num(p.prospects.transferes)}</td>
                  <td className="right tabular">{num(p.prospects.pertes)}</td>
                  <td className="right tabular"><strong>{signed(p.prospects.net)}</strong></td>
                  <td className="right tabular muted">{num(cumul[i]?.cumulP)}</td>
                  <td className="right tabular">{num(p.clients.brut)}</td>
                  <td className="right tabular">{num(p.clients.desistes)}</td>
                  <td className="right tabular"><strong>{signed(p.clients.net)}</strong></td>
                  <td className="right tabular muted">{num(cumul[i]?.cumulC)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Card>
          <p className="small muted">
            Un prospect compte pour le commercial à la date où il lui est attribué ; un client, à la date où il le devient (pour le commercial attribué ce jour-là).
            Un transfert retire le prospect à l’ancien commercial et l’ajoute au nouveau, à la date du transfert, sans modifier les périodes passées.
            Les prospects attribués avant la mise en place de ce suivi comptent à leur date de création.
          </p>
        </>
      )}
    </>
  );
}

export function ImportLists() {
  const lists = useResource('/admin/imports');
  const [open, setOpen] = useState(null);
  return (
    <>
      <p className="small muted">Chaque import de prospects (Prospects › Importer) forme une liste. Les personnes déjà présentes dans la base sont déduites : elles ne comptent pas comme nouveaux prospects et gardent leur commercial.</p>
      <ErrorBox error={lists.error} />
      <Card bodyClass="">
        {lists.loading && !lists.data ? <div className="card-body"><Skeleton h={160} /></div>
          : !lists.data?.length ? <Empty icon={FileSpreadsheet}>Aucune liste importée pour l’instant.</Empty>
          : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Liste</th><th>Commercial</th><th className="right">Lignes</th><th className="right">Doublons déduits</th><th className="right">Nouveaux</th><th className="right">En cours</th><th className="right">Clients</th><th className="right">Perdus</th><th className="right">Conversion</th></tr></thead>
              <tbody>{lists.data.map(l => (
                <tr key={l.id} className="clickable" onClick={() => setOpen(l.id)}>
                  <td><strong>{l.name}</strong><div className="small muted">{date(l.created_at)}{l.created_by_name ? ` · par ${l.created_by_name}` : ''}{l.bilan.erreurs ? ` · ${l.bilan.erreurs} ligne(s) en erreur` : ''}</div></td>
                  <td className="small">{l.assigned_name || <span className="muted">Non attribué</span>}</td>
                  <td className="right tabular">{num(l.bilan.lignes)}</td>
                  <td className="right tabular">− {num(l.bilan.doublons)}</td>
                  <td className="right tabular"><strong>{num(l.bilan.nouveaux)}</strong></td>
                  <td className="right tabular">{num(l.bilan.en_cours)}</td>
                  <td className="right tabular">{num(l.bilan.clients)}</td>
                  <td className="right tabular">{num(l.bilan.perdus)}</td>
                  <td className="right tabular">{l.bilan.conversion_pct == null ? '—' : `${l.bilan.conversion_pct} %`}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </Card>
      {open && <ImportDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ImportDetail({ id, onClose }) {
  const res = useResource(`/admin/imports/${id}`);
  const l = res.data;
  return (
    <Drawer title={l?.name || 'Liste importée'} onClose={onClose}>
      <ErrorBox error={res.error} />
      {!l ? <Skeleton h={240} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <p className="small muted">{l.filename ? `${l.filename} · ` : ''}importée le {date(l.created_at)}{l.created_by_name ? ` par ${l.created_by_name}` : ''} · {l.assigned_name ? `attribuée à ${l.assigned_name}` : 'sans commercial'}</p>
          <div className="grid grid-3">
            <div><div className="small muted">Lignes du fichier</div><div className="tabular" style={{ fontSize: 20, fontWeight: 600 }}>{num(l.bilan.lignes)}</div></div>
            <div><div className="small muted">Doublons déduits</div><div className="tabular" style={{ fontSize: 20, fontWeight: 600 }}>− {num(l.bilan.doublons)}</div></div>
            <div><div className="small muted">Nouveaux prospects</div><div className="tabular" style={{ fontSize: 20, fontWeight: 600 }}>{num(l.bilan.nouveaux)}</div></div>
            <div><div className="small muted">Devenus clients</div><div className="tabular" style={{ fontSize: 20, fontWeight: 600 }}>{num(l.bilan.clients)}</div></div>
            <div><div className="small muted">Perdus</div><div className="tabular" style={{ fontSize: 20, fontWeight: 600 }}>{num(l.bilan.perdus)}</div></div>
            <div><div className="small muted">Conversion</div><div className="tabular" style={{ fontSize: 20, fontWeight: 600 }}>{l.bilan.conversion_pct == null ? '—' : `${l.bilan.conversion_pct} %`}</div></div>
          </div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Ligne</th><th>Personne</th><th>Étape</th><th>Issue</th></tr></thead>
            <tbody>{l.items.map(it => (
              <tr key={it.lead_id}>
                <td className="small muted">{it.line ?? '—'}</td>
                <td><strong>{it.name || 'Prospect supprimé'}</strong><div className="small muted">{[it.phone, it.email].filter(Boolean).join(' · ')}</div></td>
                <td className="small">{it.stage ? stageLabel(it.stage) : '—'}</td>
                <td>{it.duplicate ? <Badge>Doublon déduit</Badge> : <Badge tone={OUTCOMES[it.outcome][1]}>{OUTCOMES[it.outcome][0]}</Badge>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </Drawer>
  );
}
