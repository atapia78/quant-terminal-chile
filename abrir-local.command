#!/bin/bash
# Doble-clic para levantar Quant Terminal en local con data viva.
# Abre http://localhost:3000 automáticamente cuando el server esté listo.
cd "$(dirname "$0")" || exit 1
( sleep 6 && open http://localhost:3000 ) &
npm run dev:full
