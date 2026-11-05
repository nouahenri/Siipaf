/**
 * Architectures Android compilées (choix du client du 05/11) : arm64-v8a et armeabi-v7a seulement, c'est-à-dire les vrais
 * téléphones, ce qui suffit pour le Play Store. x86 et x86_64 (émulateurs d'ordinateur) sont retirées : le code C++ des
 * modules n'est plus compilé que deux fois au lieu de quatre, et le build prend environ deux fois moins de temps.
 * Pour un émulateur ponctuel : ./gradlew <tâche> -PreactNativeArchitectures=x86_64
 * Écrit à chaque « npx expo prebuild » dans android/gradle.properties (reactNativeArchitectures).
 */
const { withGradleProperties } = require('@expo/config-plugins');

const ARCHS = 'armeabi-v7a,arm64-v8a';

module.exports = function withBuildArchs(config) {
  return withGradleProperties(config, cfg => {
    const props = cfg.modResults;
    const item = props.find(p => p.type === 'property' && p.key === 'reactNativeArchitectures');
    if (item) item.value = ARCHS;
    else props.push({ type: 'property', key: 'reactNativeArchitectures', value: ARCHS });
    return cfg;
  });
};
