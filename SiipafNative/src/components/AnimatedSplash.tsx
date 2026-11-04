/**
 * Écran de démarrage animé (motion design noir et rouge), posé par-dessus l'application au lancement :
 * 1. l'emblème (cercle au globe) reprend l'écran de démarrage natif, à la même place et à la même taille ;
 * 2. il fait un tour sur lui-même pendant que deux ondes rouges s'en échappent ;
 * 3. le logo glisse à sa place et « SIIPAF » se dévoile de gauche à droite ;
 * 4. « PROMOTEUR IMMOBILIER AGRÉÉ » s'écrit lettre à lettre (machine à écrire, curseur clignotant) ;
 * 5. un trait rouge se trace, puis le titre « MON RÉSEAU IMMOBILIER » monte en blanc ;
 * 6. un disque rouge envahit l'écran puis s'efface sur l'application.
 * « Réduire les animations » (Paramètres ou réglage du téléphone) : tout s'affiche d'un coup, puis fondu.
 */
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Txt } from '@/components/ui';
import { LOGO_EMBLEM, LOGO_EMBLEM_BOX } from '@/lib/content';
import { getPrefs } from '@/lib/prefs';
import { brand, fonts } from '@/theme';

/** Fond et largeur du logo : identiques à l'écran natif (app.json › expo-splash-screen, image de 76 dp). */
export const SPLASH_BG = '#0A0A0A';
export const SPLASH_LOGO_WIDTH = 300;

/** Logo pour fond noir sans sa dernière ligne (601 × 174 px), écrite ici à la machine. */
const LOGO_TOP = require('../../assets/images/site/logo-siipaf-noir-haut.png');
const LOGO_TOP_RATIO = 601 / 174;
const EMBLEM_CY_PX = 98; // centre de l'emblème dans le logo, en pixels de l'image d'origine
const TAGLINE = 'PROMOTEUR IMMOBILIER AGRÉÉ';
const TITLE = 'MON RÉSEAU IMMOBILIER';
const TYPE_MS = 42;
// Hauteurs fixes sous le logo : la colonne est centrée sans attendre de mesure
const GAP = 14, TAG_H = 24, LINE_GAP = 16, LINE_H = 3, TITLE_GAP = 14, TITLE_H = 30;

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const run = (a: Animated.CompositeAnimation) => new Promise<boolean>(r => a.start(({ finished }) => r(finished)));

export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const { width: sw, height: sh } = useWindowDimensions();
  const W = Math.min(SPLASH_LOGO_WIDTH, sw - 48);
  const H = W / LOGO_TOP_RATIO;
  const es = LOGO_EMBLEM_BOX.size * W;
  const ex = LOGO_EMBLEM_BOX.cx * W;
  const ey = (EMBLEM_CY_PX / 174) * H;
  const colH = H + GAP + TAG_H + LINE_GAP + LINE_H + TITLE_GAP + TITLE_H;
  // Décalages qui placent l'emblème au centre de l'écran, comme l'écran natif
  const dx0 = W / 2 - ex;
  const dy0 = colH / 2 - ey;
  const disc = Math.hypot(sw, sh) * 2;

  const [v] = useState(() => ({
    spin: new Animated.Value(0), pulse: new Animated.Value(1), ring1: new Animated.Value(0), ring2: new Animated.Value(0),
    slide: new Animated.Value(0), reveal: new Animated.Value(0), line: new Animated.Value(0), title: new Animated.Value(0),
    flood: new Animated.Value(0), fade: new Animated.Value(1), caret: new Animated.Value(0),
  }));
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    let live = true;
    const t = (value: Animated.Value, toValue: number, duration: number, easing = Easing.inOut(Easing.cubic), delay = 0) =>
      Animated.timing(value, { toValue, duration, easing, delay, useNativeDriver: true });
    const blink = Animated.loop(Animated.sequence([t(v.caret, 1, 1), Animated.delay(380), t(v.caret, 0, 1), Animated.delay(320)]));
    (async () => {
      const reduce = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false) || getPrefs().reduceMotion;
      if (!live) return;
      if (reduce) {
        setTyped(TAGLINE.length);
        await run(Animated.parallel([t(v.slide, 1, 1), t(v.reveal, 1, 1), t(v.line, 1, 1), t(v.title, 1, 1)]));
        await wait(700);
        await run(t(v.fade, 0, 300));
      } else {
        // Tour de l'emblème, ondes rouges
        await run(Animated.parallel([
          t(v.spin, 1, 720),
          Animated.sequence([t(v.pulse, 0.86, 340, Easing.out(Easing.quad)), t(v.pulse, 1, 380, Easing.out(Easing.back(2)))]),
          t(v.ring1, 1, 900, Easing.out(Easing.cubic), 120),
          t(v.ring2, 1, 900, Easing.out(Easing.cubic), 360),
        ]));
        if (!live) return;
        // Le logo se place et se dévoile
        await run(Animated.parallel([t(v.slide, 1, 620, Easing.out(Easing.cubic)), t(v.reveal, 1, 680, Easing.inOut(Easing.cubic))]));
        if (!live) return;
        // Machine à écrire
        blink.start();
        for (let i = 1; i <= TAGLINE.length && live; i++) { setTyped(i); await wait(TYPE_MS); }
        await wait(220);
        blink.stop();
        if (!live) return;
        v.caret.setValue(0);
        // Trait rouge puis titre
        await run(t(v.line, 1, 360, Easing.out(Easing.cubic)));
        await run(t(v.title, 1, 460, Easing.out(Easing.cubic)));
        await wait(650);
        if (!live) return;
        // Disque rouge puis fondu sur l'application
        await run(t(v.flood, 1, 420, Easing.in(Easing.cubic)));
        await run(t(v.fade, 0, 280, Easing.out(Easing.quad)));
      }
      if (live) onDone();
    })();
    return () => { live = false; blink.stop(); };
  }, [v, onDone]);

  const ring = (a: Animated.Value) => ({
    position: 'absolute' as const, left: ex - es / 2, top: ey - es / 2, width: es, height: es, borderRadius: es / 2, borderWidth: 2, borderColor: brand.red,
    opacity: a.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.75, 0] }),
    transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) }],
  });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG, alignItems: 'center', justifyContent: 'center', zIndex: 1000, opacity: v.fade }]}
      accessible accessibilityRole="image" accessibilityLabel={`SIIPAF, promoteur immobilier agréé, mon réseau immobilier`}>
      <Animated.View style={{ width: W, height: colH, alignItems: 'center', transform: [
        { translateX: v.slide.interpolate({ inputRange: [0, 1], outputRange: [dx0, 0] }) },
        { translateY: v.slide.interpolate({ inputRange: [0, 1], outputRange: [dy0, 0] }) },
      ] }}>
        <View style={{ width: W, height: H }}>
          {/* Logo dévoilé par un cache de la couleur du fond qui glisse vers la droite */}
          <View style={{ ...StyleSheet.absoluteFill, overflow: 'hidden' }}>
            <Image source={LOGO_TOP} style={{ width: W, height: H }} contentFit="contain" />
            <Animated.View style={{ ...StyleSheet.absoluteFill, backgroundColor: SPLASH_BG, transform: [{ translateX: v.reveal.interpolate({ inputRange: [0, 1], outputRange: [0, W] }) }] }} />
          </View>
          <Animated.View style={ring(v.ring1)} />
          <Animated.View style={ring(v.ring2)} />
          <Animated.View style={{ position: 'absolute', left: ex - es / 2, top: ey - es / 2, width: es, height: es,
            transform: [{ rotate: v.spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }, { scale: v.pulse }] }}>
            <Image source={LOGO_EMBLEM} style={{ width: es, height: es }} contentFit="contain" />
          </Animated.View>
        </View>

        {/* Machine à écrire : le texte complet réserve la place, la partie tapée s'affiche par-dessus */}
        <View style={{ marginTop: GAP, height: TAG_H, justifyContent: 'center' }}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, letterSpacing: 1.6, color: 'transparent' }} numberOfLines={1}>{TAGLINE}</Txt>
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center' }}>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 15, letterSpacing: 1.6, color: '#fff' }} numberOfLines={1}>{TAGLINE.slice(0, typed)}</Txt>
            <Animated.View style={{ width: 2, height: 18, marginLeft: 2, backgroundColor: brand.red, opacity: v.caret }} />
          </View>
        </View>

        <Animated.View style={{ marginTop: LINE_GAP, width: W * 0.42, height: LINE_H, borderRadius: 2, backgroundColor: brand.red, opacity: v.line, transform: [{ scaleX: v.line }] }} />

        <Animated.View style={{ marginTop: TITLE_GAP, height: TITLE_H, justifyContent: 'center', opacity: v.title,
          transform: [{ translateY: v.title.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
          <Txt style={{ fontFamily: fonts.bold, fontSize: 22, letterSpacing: 1.2, color: '#fff' }} numberOfLines={1} adjustsFontSizeToFit>{TITLE}</Txt>
        </Animated.View>
      </Animated.View>

      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: sw / 2 - disc / 2, top: sh / 2 - disc / 2, width: disc, height: disc, borderRadius: disc / 2, backgroundColor: brand.red,
        transform: [{ scale: v.flood.interpolate({ inputRange: [0, 1], outputRange: [0.001, 1] }) }] }} />
    </Animated.View>
  );
}
