/**
 * App entry point.
 */

import { App } from './ui/app.js';

const root = document.getElementById('app');
if (root) {
  new App(root);
}
