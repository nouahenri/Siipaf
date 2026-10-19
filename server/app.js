/**
 * Point d'entrée du serveur SIIPAF.
 * Sur cPanel (« Setup Node.js App »), indiquer ce fichier comme « Application startup file ».
 */
const { createApp } = require('./src/app');
const { getDb } = require('./src/db');
const { port } = require('./src/config');

const app = createApp(getDb());
app.listen(port, () => console.log(`SIIPAF API à l'écoute sur le port ${port}`));
