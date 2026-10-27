import {createLegacyRenderer} from '../../lib/renderer.js';
export function createRenderer(compositor, options = {}) {
  return createLegacyRenderer(compositor, {directComposition:false, ...options});
}
