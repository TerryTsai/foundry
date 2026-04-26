// Composition root entrypoint. tsx invokes this directly under systemd;
// boot() builds the express app, starts the reconciler, and installs
// the SIGTERM drain handler.
import { boot } from './main.js'

boot()
