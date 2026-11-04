/**
 * Photos d'une demande SAV : prises avec l'appareil photo ou choisies dans la galerie, envoyées aussitôt
 * (POST /api/client/sav/files, 6 au plus), vignettes privées affichées avec le jeton du client.
 */
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActionSheetIOS, Alert as RNAlert, Platform, Pressable, View } from 'react-native';
import { Camera, Play, X } from 'lucide-react-native';
import { Alert, Spinner, Txt } from '@/components/ui';
import { authedSource, clientApi } from '@/lib/api';
import type { SavFile } from '@/lib/types';
import { useTheme } from '@/theme';

export function PhotoStrip({ files }: { files?: SavFile[] }) {
  const { c } = useTheme();
  if (!files?.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {files.map(f => (
        <View key={f.id} style={{ width: 72, height: 72, borderRadius: 10, overflow: 'hidden', backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
          {f.mime?.startsWith('image/') ? <Image source={authedSource(f.url)} style={{ width: 72, height: 72 }} contentFit="cover" accessibilityLabel="Photo jointe" /> : <Play size={20} color={c.ink3} />}
        </View>
      ))}
    </View>
  );
}

export function PhotoField({ value, onChange }: { value: SavFile[]; onChange: (v: SavFile[]) => void }) {
  const { c, radius, fonts } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const list = assets.slice(0, 6 - value.length);
    if (!list.length) return;
    const form = new FormData();
    list.forEach((a, i) => {
      const type = a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg');
      if (Platform.OS === 'web' && a.file) form.append('files', a.file);
      else form.append('files', { uri: a.uri, name: a.fileName || `photo-${Date.now()}-${i}.${type.split('/')[1] || 'jpg'}`, type } as unknown as Blob);
    });
    setBusy(true); setError(null);
    try { onChange([...value, ...(await clientApi.post<SavFile[]>('/sav/files', form))]); } catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const fromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setError('Autorisez l’appareil photo dans les réglages du téléphone pour prendre une photo.'); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!r.canceled) upload(r.assets);
  };
  const fromLibrary = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 6 - value.length, quality: 0.7 });
    if (!r.canceled) upload(r.assets);
  };
  const choose = () => {
    if (Platform.OS === 'web') { fromLibrary(); return; }
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: ['Prendre une photo', 'Choisir dans la galerie', 'Annuler'], cancelButtonIndex: 2 }, i => { if (i === 0) fromCamera(); if (i === 1) fromLibrary(); });
      return;
    }
    RNAlert.alert('Ajouter une photo', undefined, [{ text: 'Prendre une photo', onPress: fromCamera }, { text: 'Galerie', onPress: fromLibrary }, { text: 'Annuler', style: 'cancel' }]);
  };

  return (
    <>
      <Alert>{error}</Alert>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {value.map(p => (
          <View key={p.id} style={{ width: 76, height: 76, borderRadius: 12, overflow: 'hidden', backgroundColor: c.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
            {p.mime?.startsWith('image/') ? <Image source={authedSource(p.url)} style={{ width: 76, height: 76 }} contentFit="cover" /> : <Txt variant="tiny">Vidéo</Txt>}
            <Pressable onPress={() => onChange(value.filter(x => x.id !== p.id))} accessibilityRole="button" accessibilityLabel="Retirer la photo" hitSlop={8}
              style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
              <X size={14} color="#fff" />
            </Pressable>
          </View>
        ))}
        {value.length < 6 && (
          <Pressable onPress={choose} disabled={busy} accessibilityRole="button" accessibilityLabel="Ajouter une photo"
            style={{ width: 76, height: 76, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.line, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: c.surface }}>
            {busy ? <Spinner /> : <Camera size={22} color={c.ink2} />}
            <Txt style={{ fontFamily: fonts.medium, fontSize: 11, color: c.ink2 }}>{busy ? 'Envoi…' : 'Photo'}</Txt>
          </Pressable>
        )}
      </View>
      <View style={{ height: radius.sm }} />
    </>
  );
}
