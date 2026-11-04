/**
 * Signature Android pour le Play Store, sans EAS (compilation locale, choix du client du 04/11).
 * Le dossier android/ étant régénéré par « npx expo prebuild », ce plugin ajoute à chaque fois une configuration
 * « release » qui lit la clé d'envoi dans ~/.gradle/gradle.properties (jamais dans le projet ni sur GitHub) :
 *   SIIPAF_UPLOAD_STORE_FILE=C:/chemin/vers/siipaf-upload.keystore
 *   SIIPAF_UPLOAD_KEY_ALIAS=siipaf-upload
 *   SIIPAF_UPLOAD_STORE_PASSWORD=…
 *   SIIPAF_UPLOAD_KEY_PASSWORD=…
 * Sans ces réglages, la version « release » reste signée avec la clé de test (APK d'essai, pas de Play Store).
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const MARK = '// SIIPAF : signature Play Store (plugins/withReleaseSigning.js)';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, cfg => {
    let s = cfg.modResults.contents;
    if (s.includes(MARK)) return cfg;
    // 1. Configuration « release » lue dans gradle.properties, seulement si la clé est réglée
    s = s.replace(/signingConfigs\s*\{/, `signingConfigs {
        ${MARK}
        if (project.hasProperty('SIIPAF_UPLOAD_STORE_FILE')) {
            release {
                storeFile file(SIIPAF_UPLOAD_STORE_FILE)
                storePassword SIIPAF_UPLOAD_STORE_PASSWORD
                keyAlias SIIPAF_UPLOAD_KEY_ALIAS
                keyPassword SIIPAF_UPLOAD_KEY_PASSWORD
            }
        }`);
    // 2. Le type de build « release » l'utilise quand elle existe (sinon la clé de test, comme avant)
    s = s.replace(/(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig project.hasProperty('SIIPAF_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`);
    cfg.modResults.contents = s;
    return cfg;
  });
};
