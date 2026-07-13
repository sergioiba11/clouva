import assert from 'node:assert/strict';
import { test } from 'node:test';

const { resolveAvatarAssetUrl } = await import('./lib/avatar-engine/assets.ts');
const { validateAvatarItemCompatibility } = await import('./lib/avatar-engine/load-avatar-part.ts');
const { CLOUVA_SKELETON_ID } = await import('./lib/avatar-engine/types.ts');

test('resolveAvatarAssetUrl: URL https se devuelve tal cual', () => {
  const url = resolveAvatarAssetUrl({ modelUrl: 'https://cdn.example.com/body.glb', metadata: {} });
  assert.equal(url, 'https://cdn.example.com/body.glb');
});

test('resolveAvatarAssetUrl: ruta local (/algo.glb) se devuelve tal cual', () => {
  const url = resolveAvatarAssetUrl({ modelUrl: '/models/body.glb', metadata: {} });
  assert.equal(url, '/models/body.glb');
});

test('resolveAvatarAssetUrl: sin modelUrl ni metadata devuelve null', () => {
  const url = resolveAvatarAssetUrl({ modelUrl: null, metadata: {} });
  assert.equal(url, null);
});

test('validateAvatarItemCompatibility: rechaza skeleton no oficial', () => {
  const item = { id: 'x', name: 'X', category: 'top', modelUrl: '/x.glb', free: true, compatibleSkeleton: 'otro-skeleton' };
  const result = validateAvatarItemCompatibility(item, null);
  assert.equal(result.compatible, false);
  assert.ok(result.reasons.some((r) => r.includes('Skeleton no oficial')));
});

test('validateAvatarItemCompatibility: acepta skeleton oficial con categoría válida', () => {
  const item = { id: 'x', name: 'X', category: 'top', modelUrl: '/x.glb', free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, skeletonId: CLOUVA_SKELETON_ID };
  const result = validateAvatarItemCompatibility(item, null);
  assert.equal(result.compatible, true);
});

test('validateAvatarItemCompatibility: rechaza categoría inválida', () => {
  const item = { id: 'x', name: 'X', category: 'invalida', modelUrl: '/x.glb', free: true, compatibleSkeleton: CLOUVA_SKELETON_ID };
  const result = validateAvatarItemCompatibility(item, null);
  assert.equal(result.compatible, false);
});
