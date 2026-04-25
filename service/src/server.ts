// Thin entrypoint. The HTTP server, composition root, and all route
// handlers live in @foundry/server (packages/server/). systemd and the
// deploy script still target service/dist/server.js, so this module is
// kept as a one-liner to preserve those wiring details. Phase 6+ may
// retire service/ entirely once deploy.sh and the systemd unit are
// pointed at packages/server/.
import { boot } from '@foundry/server'

boot()
