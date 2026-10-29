/**
 * Étapes du client (de la prospection au SAV) sur la fiche du bien acheté : dashboard (fiche du lot) et ERP (dossier de vente),
 * les mêmes que sur la fiche client ; cliquables avec le droit « Faire avancer dans le circuit ».
 */
import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth, useToast } from '../lib/app-context';
import { stageLabel } from '../lib/domain';

const STAGES = ['prospection', 'visite', 'decision', 'choix_bien', 'paiement', 'contrat', 'notaire', 'sav'];
export const STAGE_COLORS = {
  prospection: '#8a8f98', visite: '#2a78d6', decision: '#6d28d9', choix_bien: '#eda100',
  paiement: '#eb6834', contrat: '#1baf7a', notaire: '#15845c', livraison: '#0b6ba8', sav: '#0b6ba8', perdu: '#9f1239',
};

export default function ClientStageBar({ leadId, stage, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const staging = can('leads:stage');
  const move = async to => {
    setBusy(true);
    try { await api.patch(`/admin/leads/${leadId}`, { stage: to }); toast(`Étape : ${stageLabel(to)}`); onChanged?.(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="stagebar" role="group" aria-label="Étape du client">
      {STAGES.map(s => {
        const on = stage === s;
        return (
          <button key={s} type="button" className={on ? 'on' : ''} style={on ? { background: STAGE_COLORS[s], borderColor: STAGE_COLORS[s] } : undefined}
            disabled={!staging || on || busy} onClick={() => move(s)} aria-pressed={on}>{stageLabel(s)}</button>
        );
      })}
    </div>
  );
}
