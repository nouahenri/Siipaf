/**
 * Import de prospects ou de clients depuis un fichier CSV / Excel (.xlsx, .xls).
 * 1. lecture du fichier dans le navigateur, 2. colonnes reconnues (modifiables),
 * 3. simulation : chaque ligne est vérifiée par le serveur sans rien enregistrer, 4. import.
 */
import { useMemo, useState } from 'react';
import { Upload, FileSpreadsheet, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { clientSpaceUrl } from './ClientSpace';
import { Modal, Field, ErrorBox, Badge } from './ui';

const FIELDS = {
  prospects: [
    ['name', 'Nom', true], ['first_name', 'Prénom(s)'], ['phone', 'Téléphone'], ['email', 'E-mail'], ['country', 'Pays'], ['diaspora', 'Diaspora (oui/non)'],
    ['project', 'Projet'], ['financing', 'Financement'], ['stage', 'Étape'], ['notes', 'Notes'],
  ],
  clients: [
    ['legacy_number', 'N° (ancienne plateforme)'], ['name', 'Nom', true], ['first_name', 'Prénom(s)'], ['phone', 'Téléphone'], ['email', 'E-mail'], ['country', 'Pays'], ['diaspora', 'Diaspora (oui/non)'],
    ['project', 'Projet'], ['property_type', 'Type de bien'], ['lot', 'N° de lot'], ['ilot', 'Îlot'], ['price', 'Prix convenu'], ['financing', 'Financement'],
    ['reserved_at', 'Date de réservation'], ['paid', 'Montant déjà versé'], ['paid_at', 'Date du dernier versement'], ['client_code', 'Code client (ancien)'], ['notes', 'Notes'],
  ],
};

// Intitulés de colonnes reconnus (sans accents, en minuscules)
const SYNONYMS = {
  name: ['nom', 'nom complet', 'name', 'client', 'acquereur', 'nom et prenoms', 'nom & prenoms', 'prenom nom', 'nom prenom'],
  legacy_number: ['n°', 'n', 'no', 'num', 'n° client', 'n client', 'numero client', 'ancien numero', '#'],
  first_name: ['prenom', 'prenoms', 'prenom(s)', 'first name', 'firstname'],
  property_type: ['type de bien', 'type du bien', 'type', 'bien', 'typologie', 'type de logement'],
  phone: ['telephone', 'tel', 'phone', 'mobile', 'contact', 'numero', 'numero de telephone', 'whatsapp', 'cel', 'cellulaire'],
  email: ['email', 'e-mail', 'mail', 'courriel', 'adresse mail', 'adresse e-mail'],
  country: ['pays', 'country', 'pays de residence', 'residence'],
  diaspora: ['diaspora'],
  project: ['projet', 'programme', 'project', 'site', 'cite', 'operation'],
  financing: ['financement', 'mode de paiement', 'formule', 'mode de financement', 'option'],
  stage: ['etape', 'statut prospect', 'stage'],
  notes: ['notes', 'note', 'commentaire', 'commentaires', 'message', 'observation', 'observations'],
  lot: ['lot', 'n lot', 'no lot', 'n° lot', 'numero de lot', 'numero lot', 'parcelle', 'n° de lot'],
  ilot: ['ilot', 'bloc', 'n ilot', 'n° ilot'],
  price: ['prix', 'prix convenu', 'prix de vente', 'montant total', 'cout', 'valeur', 'prix du bien'],
  reserved_at: ['date reservation', 'date de reservation', 'date souscription', 'date de souscription', 'date d achat', 'date'],
  paid: ['verse', 'montant verse', 'deja verse', 'total verse', 'paye', 'montant paye', 'cotisations', 'total paye', 'total des versements'],
  paid_at: ['date dernier versement', 'date versement', 'dernier versement', 'date du dernier versement'],
  client_code: ['code client', 'code', 'reference', 'matricule', 'ref client', 'identifiant'],
};
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_.:]/g, ' ').replace(/\s+/g, ' ').trim();

function guessMapping(headers, mode) {
  const map = {};
  const used = new Set();
  for (const [field] of FIELDS[mode]) {
    const idx = headers.findIndex((h, i) => !used.has(i) && SYNONYMS[field].includes(fold(h)));
    if (idx >= 0) { map[field] = idx; used.add(idx); }
  }
  return map;
}

function templateCsv(mode) {
  const head = FIELDS[mode].map(f => f[1]);
  const sample = mode === 'clients'
    ? ['12', 'Koné', 'Awa', '+225 07 08 97 26 71', 'awa@example.com', 'France', 'oui', 'SIIPAF CITY AHOUTOUE', 'Villa basse jumelée 4 pièces', 'A12', 'A', '23 212 000', 'Apport 30 %', '15/01/2026', '8 000 000', '30/09/2026', '', '']
    : ['Konan', 'Yao', '0708972671', 'yao@example.com', 'Côte d’Ivoire', 'non', 'SIIPAF CITY YAMOUSSOUKRO', 'Diaspora', 'prospection', 'Contact salon'];
  const esc = v => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + [head, sample].map(r => r.map(esc).join(';')).join('\r\n');
}

/** Accès ouverts pendant l'import : un fichier à garder pour transmettre les mots de passe provisoires. */
function accessCsv(report) {
  const esc = v => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const url = clientSpaceUrl();
  const rows = report.filter(r => r.access).map(r => [
    r.name, r.access.client_code, r.access.phone || '', r.access.temporary_password,
    `Bonjour ${r.name}, votre espace client SIIPAF est ouvert : ${url} — Identifiant : ${r.access.client_code}${r.access.phone ? ` ou ${r.access.phone}` : ''} — Mot de passe provisoire : ${r.access.temporary_password}`,
  ]);
  return '﻿' + [['Client', 'Code client', 'Téléphone', 'Mot de passe provisoire', 'Message à envoyer'], ...rows].map(r => r.map(v => esc(String(v))).join(';')).join('\r\n');
}

export default function ImportModal({ mode: initialMode = 'prospects', onClose, onDone, allowModes = ['prospects', 'clients'] }) {
  const toast = useToast();
  const { can, user } = useAuth();
  const [mode, setMode] = useState(initialMode);
  // Liste de prospects : un fichier importé = une liste, avec son bilan (Portefeuille commercial)
  const [listName, setListName] = useState('');
  const manager = can('leads:all');
  const [assignTo, setAssignTo] = useState(manager ? '' : String(user.id));
  const sellers = useResource(manager ? '/admin/users/commerciaux' : null);
  const [file, setFile] = useState(null);
  const [sheet, setSheet] = useState(null); // { headers, rows }
  const [mapping, setMapping] = useState({});
  const [createLots, setCreateLots] = useState(true);
  const [openAccess, setOpenAccess] = useState(can('client_access:write'));
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const read = async f => {
    setError(null); setResult(null); setFile(f);
    setListName(n => n || f.name.replace(/.(csv|txt|xlsx?|xls)$/i, ''));
    try {
      const XLSX = await import('xlsx');
      // CSV lu tel quel : sinon « +2250708972671 » devient un nombre et perd son « + »
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false, raw: /\.(csv|txt)$/i.test(f.name) });
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false });
      const headerRow = data.findIndex(r => r.filter(c => c != null && String(c).trim()).length >= 2);
      if (headerRow < 0) throw new Error('Le fichier ne contient pas de ligne d’en-têtes.');
      const headers = data[headerRow].map(h => (h == null ? '' : String(h).trim()));
      const rows = data.slice(headerRow + 1).map((r, i) => ({ cells: r, line: headerRow + i + 2 }))
        .filter(r => r.cells.some(c => c != null && String(c).trim() !== ''));
      setSheet({ headers, rows });
      setMapping(guessMapping(headers, mode));
    } catch (e) { setSheet(null); setError(new Error(`Lecture impossible : ${e.message}`)); }
  };

  const payloadRows = useMemo(() => (sheet ? sheet.rows.map(r => {
    const o = { _line: r.line };
    for (const [field, idx] of Object.entries(mapping)) if (idx != null && idx !== '') o[field] = r.cells[idx] == null ? null : (typeof r.cells[idx] === 'number' ? r.cells[idx] : String(r.cells[idx]).slice(0, 500));
    return o;
  }) : []), [sheet, mapping]);
  const missing = FIELDS[mode].filter(([f, , req]) => req && (mapping[f] == null || mapping[f] === '')).map(f => f[1]);

  // Envoi par paquets : l'ouverture des accès chiffre un mot de passe par ligne, une seule requête serait trop longue
  const CHUNK = 20;
  const run = async dryRun => {
    setError(null); setBusy(true);
    const merged = { dryRun, total: 0, ok: 0, errors: 0, report: [] };
    let listId = null;
    try {
      for (let i = 0; i < payloadRows.length; i += CHUNK) {
        setProgress(`${Math.min(i + CHUNK, payloadRows.length)} / ${payloadRows.length}`);
        const list = dryRun ? undefined : listId ? { id: listId } : { name: listName.trim() || file?.name, filename: file?.name, assigned_to: assignTo ? Number(assignTo) : null };
        const res = await api.post('/admin/import', { mode, rows: payloadRows.slice(i, i + CHUNK), dry_run: dryRun, create_lots: createLots, open_access: mode === 'clients' && openAccess, list });
        listId = listId || res.import_id || null;
        merged.total += res.total; merged.ok += res.ok; merged.errors += res.errors; merged.report.push(...res.report);
      }
    } catch (e) {
      // Les paquets déjà passés restent enregistrés : on montre leur compte rendu (et leurs accès) avec l'erreur
      setError(e);
    }
    if (merged.report.length) setResult(merged);
    if (!dryRun && merged.ok) { toast(`${merged.ok} ligne(s) importée(s)`); onDone?.(); }
    setProgress(null); setBusy(false);
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([templateCsv(mode)], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `modele-import-${mode}.csv` });
    a.click(); URL.revokeObjectURL(url);
  };

  const imported = result && !result.dryRun;
  const accessCount = imported ? result.report.filter(r => r.access).length : 0;
  const downloadAccess = () => {
    const url = URL.createObjectURL(new Blob([accessCsv(result.report)], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'acces-espace-client.csv' });
    a.click(); URL.revokeObjectURL(url);
  };
  return (
    <Modal title={mode === 'clients' ? 'Importer des clients' : 'Importer des prospects'} onClose={onClose}
      footer={<>
        {progress && <span className="small muted tabular" style={{ marginRight: 'auto' }}>Lignes {progress}…</span>}
        <button className="btn" onClick={onClose}>{imported ? 'Fermer' : 'Annuler'}</button>
        {sheet && !imported && <button className="btn" disabled={busy || !!missing.length} onClick={() => run(true)}><CheckCircle2 />Vérifier ({payloadRows.length} lignes)</button>}
        {result?.dryRun && result.ok > 0 && <button className="btn btn-primary" disabled={busy} onClick={() => run(false)}><Upload />Importer {result.ok} ligne(s)</button>}
      </>}>
      <ErrorBox error={error} />
      {allowModes.length > 1 && !sheet && (
        <div className="seg" style={{ marginBottom: 12 }}>
          {allowModes.map(m => <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>{m === 'clients' ? 'Clients (avec dossier)' : 'Prospects'}</button>)}
        </div>
      )}
      <p className="small muted" style={{ marginBottom: 10 }}>
        {mode === 'clients'
          ? 'Chaque ligne crée (ou retrouve) le client, ouvre son dossier d’acquisition sur le lot indiqué (le lot passe « réservé », l’échéancier est calculé) et reprend le montant déjà versé.'
          : 'Chaque ligne crée un prospect ; une personne déjà connue (même téléphone ou e-mail) est complétée, pas dupliquée.'}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="btn btn-primary">
          <FileSpreadsheet />{file ? 'Changer de fichier' : 'Choisir un fichier CSV ou Excel'}
          <input type="file" hidden accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => e.target.files[0] && read(e.target.files[0])} />
        </label>
        <button className="btn btn-ghost btn-sm" onClick={downloadTemplate}><Download />Modèle à remplir</button>
        {file && <span className="small muted">{file.name} · {sheet?.rows.length ?? 0} ligne(s)</span>}
      </div>

      {sheet && !imported && (
        <>
          <h3 className="small" style={{ margin: '16px 0 8px', fontWeight: 600 }}>Colonnes du fichier</h3>
          <div className="form-grid">
            {FIELDS[mode].map(([field, label, req]) => (
              <Field key={field} label={<>{label}{req && <span style={{ color: 'var(--brand)' }}> *</span>}</>}>
                <select className="select" value={mapping[field] ?? ''} onChange={e => setMapping(m => ({ ...m, [field]: e.target.value === '' ? null : Number(e.target.value) }))}>
                  <option value="">— Ignorer —</option>
                  {sheet.headers.map((h, i) => <option key={i} value={i}>{h || `Colonne ${i + 1}`}</option>)}
                </select>
              </Field>
            ))}
          </div>
          {missing.length > 0 && <p className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>À associer : {missing.join(', ')}.</p>}
          <div className="form-grid" style={{ marginTop: 12 }}>
            <Field label="Nom de la liste" hint="Pour suivre son bilan dans Portefeuille commercial"><input className="input" value={listName} maxLength={160} onChange={e => setListName(e.target.value)} /></Field>
            <Field label="Commercial attribué aux nouveaux" hint="Les personnes déjà connues gardent leur commercial">
              {manager ? (
                <select className="select" value={assignTo} onChange={e => setAssignTo(e.target.value)}>
                  <option value="">Aucun (à répartir ensuite)</option>
                  {sellers.data?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              ) : <input className="input" value={user.name} disabled />}
            </Field>
          </div>
          {mode === 'clients' && (
            <>
              <p className="small muted" style={{ marginTop: 8 }}>Sans n° de lot, le client est repris « sans dossier » : il reçoit son code client et son type de bien ; le lot et le prix s’ajoutent ensuite depuis sa fiche.</p>
              <label className="checkbox small" style={{ marginTop: 10 }}><input type="checkbox" checked={createLots} onChange={e => setCreateLots(e.target.checked)} />Créer les lots qui n’existent pas encore dans le projet</label>
              {can('client_access:write') && (
                <label className="checkbox small" style={{ marginTop: 6 }}><input type="checkbox" checked={openAccess} onChange={e => setOpenAccess(e.target.checked)} />Ouvrir l’espace client de chaque client importé (mot de passe provisoire, à transmettre)</label>
              )}
            </>
          )}
        </>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <Badge tone="ok" dot>{result.ok} {result.dryRun ? 'prête(s)' : 'importée(s)'}</Badge>
            {result.errors > 0 && <Badge tone="danger" dot>{result.errors} en erreur</Badge>}
            {result.dryRun && <span className="small muted">Simulation : rien n’a encore été enregistré.</span>}
          </div>
          <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="table"><tbody>
              {result.report.map(r => (
                <tr key={r.line}>
                  <td className="small muted nowrap">Ligne {r.line}</td>
                  <td className="small">{r.name || '—'}</td>
                  <td className="small">{r.ok ? <span style={{ color: 'var(--ok)' }}>{r.action}</span> : <span style={{ color: 'var(--danger)' }}><AlertTriangle size={13} style={{ verticalAlign: '-2px' }} /> {r.error}</span>}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
          {accessCount > 0 && (
            <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={downloadAccess}><Download />Télécharger les {accessCount} accès (CSV)</button>
              <span className="small muted">Mots de passe provisoires affichés une seule fois : téléchargez-les avant de fermer.</span>
            </div>
          )}
          {result.dryRun && result.errors > 0 && <p className="small muted" style={{ marginTop: 8 }}>Les lignes en erreur seront ignorées. Corrigez-les dans le fichier puis réimportez-les plus tard si besoin.</p>}
        </div>
      )}
    </Modal>
  );
}
