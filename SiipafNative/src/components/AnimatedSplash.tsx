/**
 * Écran de démarrage animé (motion design noir et rouge), posé par-dessus l'application au lancement :
 * 1. l'emblème (cercle au globe) reprend l'écran de démarrage natif, à la même place et à la même taille ;
 * 2. il fait un tour sur lui-même pendant que deux ondes rouges s'en échappent ;
 * 3. le logo glisse au centre et « SIIPAF » se dévoile de gauche à droite ;
 * 4. un trait rouge se trace sous le logo ;
 * 5. un disque rouge envahit l'écran puis s'efface sur l'application.
 * « Réduire les animations » (Paramètres ou réglage du téléphone) : simple fondu.
 * Tout passe par le pilote natif (transformations et opacité) : fluide même pendant le chargement.
 */
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LOGO_EMBLEM, LOGO_EMBLEM_BOX, LOGO_ON_DARK, LOGO_RATIO } from '@/lib/content';
import { getPrefs } from '@/lib/prefs';
import { brand } from '@/theme';

/** Fond et largeur du logo : identiques à l'écran natif (app.json › expo-splash-screen, image de 76 dp). */
export const SPLASH_BG = '#0A0A0A';
export const SPLASH_LOGO_WIDTH = 300;

export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const { width: sw, height: sh } = useWindowDimensions();
  const W = Math.min(SPLASH_LOGO_WIDTH, sw - 48);
  const H = W / LOGO_RATIO;
  const es = LOGO_EMBLEM_BOX.size * W;
  const ex = LOGO_EMBLEM_BOX.cx * W;
  const ey = LOGO_EMBLEM_BOX.cy * H;
  const dx0 = W / 2 - ex; // décalage qui centre l'emblème à l'écran
  const disc = Math.hypot(sw, sh) * 2;

  const [v] = useState(() => ({
    spin: new Animated.Value(0), pulse: new Animated.Value(1), ring1: new Animated.Value(0), ring2: new Animated.Value(0),
    slide: new Animated.Value(0), reveal: new Animated.Value(0), line: new Animated.Value(0), flood: new Animated.Value(0), fade: new Animated.Value(1),
  }));

  useEffect(() => {
    let live = true;
    const t = (value: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.cubic), delay = 0) =>
      Animated.timing(value, { toValue, duration, easing, delay, useNativeDriver: true });
    AccessibilityInfo.isReduceMotionEnabled().catch(() => false).then(sys => {
      if (!live) return;
      const anim = sys || getPrefs().reduceMotion
        ? Animated.sequence([
          Animated.parallel([t(v.slide, 1, 1), t(v.reveal, 1, 1), t(v.line, 1, 1)]),
          Animated.delay(450), t(v.fade, 0, 300),
        ])
        : Animated.sequence([
          // Tour de l'emblème, ondes rouges
          Animated.parallel([
            t(v.spin, 1, 720),
            Animated.sequence([t(v.pulse, 0.86, 340, Easing.out(Easing.quad)), t(v.pulse, 1, 380, Easing.out(Easing.back(2)))]),
            t(v.ring1, 1, 900, Easing.out(Easing.cubic), 120),
            t(v.ring2, 1, 900, Easing.out(Easing.cubic), 360),
          ]),
          // Le logo se place et se dévoile
          Animated.parallel([t(v.slide, 1, 620, Easing.out(Easing.cubic)), t(v.reveal, 1, 680, Easing.inOut(Easing.cubic))]),
          t(v.line, 1, 380, Easing.out(Easing.cubic)),
          Animated.delay(260),
          // Disque rouge puis fondu sur l'application
          t(v.flood, 1, 420, Easing.in(Easing.cubic)),
          t(v.fade, 0, 280, Easing.out(Easing.quad)),
        ]);
      anim.start(({ finished }) => { if (finished && live) onDone(); });
    });
    return () => { live = false; };
  }, [v, onDone]);

  const ring = (a: Animated.Value) => ({
    position: 'absolute' as const, left: ex - es / 2, top: ey - es / 2, width: es, height: es, borderRadius: es / 2, borderWidth: 2, borderColor: brand.red,
    opacity: a.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.75, 0] }),
    transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) }],
  });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG, alignItems: 'center', justifyContent: 'center', zIndex: 1000, opacity: v.fade }]}
      accessible accessibilityRole="image" accessibilityLabel="SIIPAF, promoteur immobilier agréé">
      <Animated.View style={{ width: W, height: H, transform: [{ translateX: v.slide.interpolate({ inputRange: [0, 1], outputRange: [dx0, 0] }) }] }}>
        {/* Logo dévoilé par un cache de la couleur du fond qui glisse vers la droite */}
        <View style={{ ...StyleSheet.absoluteFill, overflow: 'hidden' }}>
          <Image source={LOGO_ON_DARK} style={{ width: W, height: H }} contentFit="contain" />
          <Animated.View style={{ ...StyleSheet.absoluteFill, backgroundColor: SPLASH_BG, transform: [{ translateX: v.reveal.interpolate({ inputRange: [0, 1], outputRange: [0, W] }) }] }} />
        </View>
        <Animated.View style={ring(v.ring1)} />
        <Animated.View style={ring(v.ring2)} />
        <Animated.View style={{ position: 'absolute', left: ex - es / 2, top: ey - es / 2, width: es, height: es,
          transform: [{ rotate: v.spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }, { scale: v.pulse }] }}>
          <Image source={LOGO_EMBLEM} style={{ width: es, height: es }} contentFit="contain" />
        </Animated.View>
      </Animated.View>
      <Animated.View style={{ marginTop: 22, width: W * 0.42, height: 3, borderRadius: 2, backgroundColor: brand.red, opacity: v.line, transform: [{ scaleX: v.line }] }} />
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: sw / 2 - disc / 2, top: sh / 2 - disc / 2, width: disc, height: disc, borderRadius: disc / 2, backgroundColor: brand.red,
        transform: [{ scale: v.flood.interpolate({ inputRange: [0, 1], outputRange: [0.001, 1] }) }] }} />
    </Animated.View>
  );
}
