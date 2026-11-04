/** Photos et vidéos du chantier : vignettes (4 au plus, « +N ») et visionneuse plein écran à balayer. */
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { FlatList, Modal, Pressable, StatusBar, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Play, X } from 'lucide-react-native';
import { IconButton, Txt } from '@/components/ui';
import { apiUrl } from '@/lib/api';
import type { Media } from '@/lib/types';
import { useTheme } from '@/theme';

export function Gallery({ media, onOpen }: { media: Media[]; onOpen: (i: number) => void }) {
  const { radius, fonts } = useTheme();
  if (!media.length) return null;
  const shown = media.slice(0, 4);
  const big = shown.length === 1 || shown.length === 3;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: 'hidden' }}>
      {shown.map((m, i) => (
        <Pressable key={m.id} onPress={() => onOpen(i)} accessibilityRole="imagebutton" accessibilityLabel={`Agrandir ${m.kind === 'video' ? 'la vidéo' : 'la photo'} ${i + 1}`}
          style={{ width: big && i === 0 ? '100%' : '49.5%', flexGrow: 1, height: big && i === 0 ? 210 : 130, backgroundColor: '#222' }}>
          {m.kind === 'video'
            ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' }}><Play size={22} color="#111" fill="#111" /></View></View>
            : <Image source={{ uri: apiUrl(m.url)! }} style={{ flex: 1 }} contentFit="cover" transition={200} recyclingKey={String(m.id)} />}
          {i === 3 && media.length > 4 ? (
            <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
              <Txt style={{ color: '#fff', fontFamily: fonts.bold, fontSize: 22 }}>+{media.length - 4}</Txt>
            </View>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function VideoSlide({ uri, width, height, active }: { uri: string; width: number; height: number; active: boolean }) {
  const player = useVideoPlayer(uri, p => { p.loop = false; });
  if (!active) player.pause();
  return <VideoView player={player} style={{ width, height }} contentFit="contain" nativeControls />;
}

export function Lightbox({ items, index, caption, onClose }: { items: Media[]; index: number; caption?: string; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(index);
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <FlatList
          data={items}
          horizontal
          pagingEnabled
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={e => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
          keyExtractor={m => String(m.id)}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item: m, index: i }) => (
            <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
              {m.kind === 'video'
                ? <VideoSlide uri={apiUrl(m.url)!} width={width} height={height * 0.8} active={i === current} />
                : <Image source={{ uri: apiUrl(m.url)! }} style={{ width, height: height * 0.8 }} contentFit="contain" accessibilityLabel={m.alt || caption || 'Photo du chantier'} />}
            </View>
          )}
        />
        <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', alignItems: 'center' }}>
          <Txt style={{ color: '#fff', flex: 1 }} numberOfLines={1}>{caption}{items.length > 1 ? ` · ${current + 1}/${items.length}` : ''}</Txt>
          <IconButton icon={X} label="Fermer" tone="light" size={40} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
