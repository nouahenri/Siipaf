/**
 * Pièce jointe d'un envoi multipart (photos SAV, capture du reçu, CV).
 *
 * Depuis le SDK 58, le `fetch` global est celui d'Expo (expo/fetch) : il ne sait plus lire l'ancienne forme React Native
 * `{ uri, name, type }` et lève « Unsupported FormDataPart implementation » avant même de contacter le serveur (affiché
 * « Connexion impossible »). On lui donne donc un objet qui expose `bytes()`, lu depuis le fichier local avec
 * expo-file-system. Sur le web, le fichier du navigateur est joint tel quel.
 */
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

export type LocalFile = { uri: string; name: string; type: string; file?: Blob | null };

export function appendFile(form: FormData, field: string, f: LocalFile) {
  if (Platform.OS === 'web') {
    if (f.file) form.append(field, f.file, f.name);
    return;
  }
  const local = new File(f.uri);
  const part = { name: f.name, type: f.type, bytes: () => local.bytes() };
  form.append(field, part as unknown as Blob);
}
