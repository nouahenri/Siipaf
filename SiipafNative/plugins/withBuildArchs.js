/**
 * Architectures Android compilées (choix du client du 05/11) : arm64-v8a et armeabi-v7a seulement, c'est-à-dire les vrais
 * téléphones, ce qui suffit pour le Play Store. x86 et x86_64 (émulateurs d'ordinateur) sont retirées : le code C++ des
 * modules n'est plus compilé que deux fois au lieu de quatre, et le build prend environ deux fois moins de temps.
 * Pour un émulateur ponctuel : ./gradlew <tâche> -PreactNativeArchitectures=x86_64
 * Écrit à chaque « npx expo prebuild » dans android/gradle.properties (reactNativeArchitectures).
 */
const { withGradleProperties } = require('@expo/config-plugins');

const ARCHS = 'armeabi-v7a,arm64-v8a';

// Sous Windows, la surveillance des dossiers par Gradle garde des poignées ouvertes sur node_modules/*/android/build :
// un second démon (synchro d'Android Studio puis build) ne peut plus les vider (« Unable to delete directory », 05/11).
const PROPS = { reactNativeArchitectures: ARCHS, 'org.gradle.vfs.watch': 'false' };

module.exports = function withBuildArchs(config) {
  return withGradleProperties(config, cfg => {
    const props = cfg.modResults;
    for (const [key, value] of Object.entries(PROPS)) {
      const item = props.find(p => p.type === 'property' && p.key === key);
      if (item) item.value = value;
      else props.push({ type: 'property', key, value });
    }
    return cfg;
  });
};
