import {BUILD} from './build.js';
import {pwa} from './pwa.js';
document.getElementById('appVersion').textContent=`v${BUILD.version}`;
pwa.onchange=()=>pwa.render();
await pwa.start();pwa.render();
// Do not combine a fresh entry point with modules cached by a legacy worker.
if(pwa.compatible)await import('./app.js');
else document.getElementById('status').textContent=pwa.updateAvailable?'Atualize para carregar esta versão do AR Play.':'Não foi possível confirmar o build. Feche as abas do AR Play e abra novamente.';
