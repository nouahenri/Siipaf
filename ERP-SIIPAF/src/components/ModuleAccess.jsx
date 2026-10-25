/**
 * Rôles et privilèges d'un module de l'ERP : ce que chaque rôle peut faire dans le module, action par action
 * (créer, traiter, valider, payer, exporter…). Mêmes réglages que « Rôles & privilèges » du dashboard (table
 * role_permissions), filtrés sur le module. Consultation : « Voir les utilisateurs » ; modification : super administrateur.
 */
import { useMemo, useState } from 'react';
import { Check, ShieldCheck, ExternalLink, Info } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useResource, useToast } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Badge } from '@admin/components/ui';

// Groupes du catalogue (lib/domain.js) affichés dans chaque module
const MODULE_GROUPS = {
  achats: ['ERP · Achats & stocks'],
  commercial: ['ERP · Service commercial', 'Ventes', 'Dossiers d’acquisition'],
  compta: ['ERP · Comptabilité', 'ERP · Paie'],
  rh: ['ERP · Ressources humaines', 'ERP · Espace employé'],
  sav: ['ERP · Client & SAV'],
  administration: ['ERP · Administration générale'],
  juridique: ['ERP · Juridique', 'Dossiers d’acquisition'],
  chantiers: ['ERP · Chantiers'],
};

const dashboardUrl = () => `${window.location.protocol}//${window.location.host.replace(/^erp\./, 'admin.')}/roles`;

export default function ModuleAccess({ module, label }) {
  const toast = useToast();
  const cat = useResource('/admin/permissions');
  const [busy, setBusy] = useState(null);
  const groups = useMemo(() => (cat.data ? MODULE_GROUPS[module].map(g => cat.data.catalog.find(c => c.group === g)).filter(Boolean) : []), [cat.data, module]);
  if (cat.error) return <ErrorBox error={cat.error} />;
  if (!cat.data) return <Skeleton h={300} />;
  const canEdit = cat.data.can_edit;
  const roles = cat.data.roles;

  const toggle = async (role, perm) => {
    setBusy(`${role.id}:${perm}`);
    const has = role.permissions.includes(perm);
    const permissions = has ? role.permissions.filter(p => p !== perm) : [...role.permissions, perm];
    try { await api.put(`/admin/permissions/roles/${role.id}`, { permissions }); await cat.reload(); toast(`${role.label} : action ${has ? 'retirée' : 'autorisée'}`); } catch (e) { toast(e.message, 'err'); } finally { setBusy(null); }
  };

  return (
    <div className="stack">
      <div className="callout-erp"><ShieldCheck /><span className="small">
        Ce que chaque rôle peut faire dans le module <b>{label}</b>. Un compte reçoit les actions de son rôle.
        {canEdit ? ' Cliquez une case pour autoriser ou retirer une action.' : ' Seul le super administrateur peut les modifier.'} Les rôles se créent et s’attribuent aux comptes dans le dashboard (<a className="link" href={dashboardUrl()}>Rôles & privilèges <ExternalLink className="ico" /></a>).
      </span></div>
      {groups.map(g => (
        <Card key={g.group} title={g.group.replace(/^ERP · /, '')} bodyClass="">
          <div className="table-wrap"><table className="table perm-table">
            <thead><tr><th>Action</th>{roles.map(r => <th key={r.id} className="center perm-col" title={r.description || undefined}>{r.label}<div className="muted" style={{ fontWeight: 400 }}>{r.users} compte(s)</div></th>)}</tr></thead>
            <tbody>{g.items.map(i => (
              <tr key={i.id}>
                <td><b className="small">{i.label}</b>{i.hint && <div className="small muted">{i.hint}</div>}</td>
                {roles.map(r => {
                  const on = r.locked || r.permissions.includes(i.id);
                  return (
                    <td key={r.id} className="center">
                      <button className={`perm-cell ${on ? 'on' : ''}`} disabled={!canEdit || r.locked || busy === `${r.id}:${i.id}`} onClick={() => toggle(r, i.id)}
                        aria-pressed={on} aria-label={`${i.label} — ${r.label}`} title={r.locked ? 'Super administrateur : toutes les actions' : on ? 'Autorisé' : 'Non autorisé'}>{on ? <Check /> : null}</button>
                    </td>
                  );
                })}
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      ))}
      <p className="small muted row" style={{ gap: 8 }}>
        {!canEdit && <Badge>Lecture seule</Badge>}<Info className="ico" />Le serveur vérifie chaque action : un bouton masqué ne suffit pas, une action non autorisée est refusée.
      </p>
    </div>
  );
}
