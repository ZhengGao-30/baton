'use strict';
// Preloaded (node --require) into the Baton tool process by a test: throws a stray error and a rejected promise
// shortly after start, the way a status-file write that fails at the wrong moment used to.
setTimeout(() => { throw new Error('boom: stray exception'); }, 250);
setTimeout(() => { Promise.reject(new Error('boom: stray rejection')); }, 350);
