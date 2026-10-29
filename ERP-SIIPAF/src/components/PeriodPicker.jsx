/**
 * Période des objectifs et de la performance : une année, puis l'année entière, un trimestre ou un mois (choix du client
 * du 27/10 : toutes les périodes, avec filtre). Utilisé par RH › Performance et entretiens et la Vue Direction.
 */
import { qs } from '@admin/lib/api';

export const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
export const thisYear = new Date().getFullYear();
export const yearPeriod = (annee = thisYear) => ({ annee, periode: 'annee', n: null });
/** Paramètres d'URL de la période (?annee=&periode=&n=). */
export const periodQuery = p => qs({ annee: p.annee, periode: p.periode, n: p.periode === 'annee' ? null : p.n });
/** Libellé court : « 2026 », « T3 2026 », « octobre 2026 ». */
export const periodName = p => (p.periode === 'mois' ? `${MONTHS[p.n - 1].toLowerCase()} ${p.annee}` : p.periode === 'trimestre' ? `T${p.n} ${p.annee}` : String(p.annee));

const KINDS = [['annee', 'Année'], ['trimestre', 'Trimestre'], ['mois', 'Mois']];

export default function PeriodPicker({ value, onChange }) {
  const set = patch => onChange({ ...value, ...patch });
  const now = new Date();
  // Changer de découpage propose la période en cours de l'année choisie
  const pick = k => set({ periode: k, n: k === 'annee' ? null : k === 'mois' ? now.getMonth() + 1 : Math.floor(now.getMonth() / 3) + 1 });
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <select className="select" style={{ width: 'auto' }} value={value.annee} onChange={e => set({ annee: Number(e.target.value) })} aria-label="Année">
        {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <div className="seg" role="group" aria-label="Découpage de la période">
        {KINDS.map(([k, l]) => <button key={k} type="button" className={value.periode === k ? 'active' : ''} aria-pressed={value.periode === k} onClick={() => pick(k)}>{l}</button>)}
      </div>
      {value.periode === 'trimestre' && (
        <select className="select" style={{ width: 'auto' }} value={value.n} onChange={e => set({ n: Number(e.target.value) })} aria-label="Trimestre">
          {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n === 1 ? '1er' : `${n}e`} trimestre</option>)}
        </select>
      )}
      {value.periode === 'mois' && (
        <select className="select" style={{ width: 'auto' }} value={value.n} onChange={e => set({ n: Number(e.target.value) })} aria-label="Mois">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
      )}
    </div>
  );
}
