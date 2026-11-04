/**
 * Photos d'un programme en tête de fiche : image principale puis galerie du dashboard (Projets › Galerie photos).
 * Photo à balayer, rangée de vignettes posée sur le bas de la photo (5 au plus, « +N » sur la dernière), plein écran
 * au toucher (visionneuse de l'espace client). Sans galerie : l'image principale seule.
 */
import { Image, type ImageSource } from 'expo-image';
import React, { useRef, useState } from 'react';
import { FlatList, Pressable, View, useWindowDimensions } from 'react-native';
import { Lightbox } from '@/components/client/Media';
import { Txt } from '@/components/ui';
import { apiUrl } from '@/lib/api';
import * as Haptics from '@/lib/haptics';
import type { Media } from '@/lib/types';
import { useTheme } from '@/theme';

const THUMBS = 5;

export function ProjectGallery({ photos, fallback, height, name, bottomInset = 0 }: {
  photos: { id: number; url: string; alt?: string | null }[]; fallback: ImageSource | number; height: number; name: string;
  /** Hauteur couverte en bas par la feuille de la fiche : les vignettes restent au-dessus. */
  bottomInset?: number;
}) {
  const { c, fonts } = useTheme();
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<Media>>(null);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const items: Media[] = photos.map(p => ({ id: p.id, url: p.url, alt: p.alt, kind: 'image' }));

  if (items.length < 2) {
    const one = items[0];
    return (
      <Pressable onPress={one ? () => setOpen(0) : undefined} disabled={!one} accessibilityRole={one ? 'imagebutton' : 'image'} accessibilityLabel={name}>
        <Image source={one ? { uri: apiUrl(one.url)! } : fallback} style={{ height, backgroundColor: c.surfaceAlt }} contentFit="cover" transition={250} />
        {open != null && <Lightbox items={items} index={open} caption={name} onClose={() => setOpen(null)} />}
      </Pressable>
    );
  }

  const go = (i: number) => {
    Haptics.selectionAsync().catch(() => {});
    setIndex(i);
    list.current?.scrollToIndex({ index: i, animated: true });
  };
  const more = items.length - THUMBS;
  return (
    <View style={{ height, backgroundColor: c.surfaceAlt }}>
      <FlatList
        ref={list}
        data={items}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={m => String(m.id)}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index: i }) => (
          <Pressable onPress={() => setOpen(i)} accessibilityRole="imagebutton" accessibilityLabel={`${name}, photo ${i + 1} sur ${items.length}`}>
            <Image source={{ uri: apiUrl(item.url)! }} style={{ width, height }} contentFit="cover" transition={200} />
          </Pressable>
        )}
      />

      {/* Vignettes sur le bas de la photo */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: bottomInset + 12, alignItems: 'center' }} pointerEvents="box-none">
        <View style={{ flexDirection: 'row', gap: 6, padding: 5, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.35)' }}>
          {items.slice(0, THUMBS).map((m, i) => {
            const last = i === THUMBS - 1 && more > 0;
            const active = i === index || (last && index >= THUMBS - 1);
            return (
              <Pressable key={m.id} onPress={() => (last ? setOpen(i) : go(i))} accessibilityRole="button"
                accessibilityLabel={last ? `${more + 1} photos de plus` : `Photo ${i + 1}`} accessibilityState={{ selected: active }}
                style={{ width: 50, height: 50, borderRadius: 11, overflow: 'hidden', borderWidth: 2, borderColor: active ? '#fff' : 'transparent' }}>
                <Image source={{ uri: apiUrl(m.url)! }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                {last ? (
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
                    <Txt style={{ fontFamily: fonts.bold, fontSize: 14, color: '#fff' }}>+{more + 1}</Txt>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      {open != null && <Lightbox items={items} index={open} caption={name} onClose={() => setOpen(null)} />}
    </View>
  );
}
