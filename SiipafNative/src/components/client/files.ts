/**
 * Fichiers privés de l'espace client (documents du dossier, procès-verbal) : téléchargés avec le jeton dans le cache du
 * téléphone, puis ouverts dans la visionneuse du système (Aperçu rapide sur iPhone, lecteur PDF sur Android) d'où le client
 * peut les enregistrer, les imprimer ou les partager. Sur le web (aperçu de développement), ouverture dans un onglet.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { apiUrl, appHeaders } from '@/lib/api';

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) || 'document';

/** Télécharge le fichier dans le cache et renvoie son adresse locale. */
export async function downloadPrivate(path: string, name: string): Promise<string> {
  const url = apiUrl(path)!;
  if (Platform.OS === 'web') return url;
  const dest = new File(Paths.cache, `${Date.now()}-${safeName(name)}`);
  const task = File.createDownloadTask(url, dest, { headers: appHeaders() });
  const out = await task.downloadAsync();
  if (!out?.exists) throw new Error('Téléchargement impossible. Réessayez.');
  return out.uri;
}

/** Ouvre le fichier dans la visionneuse du téléphone (avec Enregistrer / Imprimer / Partager). */
export async function openPrivateFile(path: string, name: string, mimeType = 'application/pdf') {
  if (Platform.OS === 'web') { globalThis.open?.(apiUrl(path)!, '_blank'); return; }
  const uri = await downloadPrivate(path, name);
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: name, UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined });
}
