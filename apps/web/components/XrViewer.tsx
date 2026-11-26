'use client';
import { useEffect, useRef, useState } from 'react';

export interface XrAsset { id: string; title: string; kind: 'model_3d' | 'panorama_360'; url: string; ios_url?: string | null; alt_text: string }

const hasWebGl = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } };
const xrSupported = async (mode: 'immersive-ar' | 'immersive-vr') => { try { const xr = (navigator as any).xr; return !!xr && (await xr.isSessionSupported(mode)); } catch { return false; } };

/** WebXR + three.js viewer. Degrades in order: AR / VR session → draggable 3D or panorama view → plain image or text description. */
export default function XrViewer({ asset, height = 360 }: { asset: XrAsset; height?: number }) {
  const host = useRef<HTMLDivElement>(null); const [mode, setMode] = useState('chargement…'); const [err, setErr] = useState('');
  useEffect(() => {
    let stop = () => {}; let gone = false;
    (async () => {
      setErr('');
      if (!hasWebGl()) { setMode('image_only'); return; }
      const el = host.current; if (!el) return;
      try {
        const THREE: any = await import('three');
        // @ts-ignore three examples ship without bundled types for these deep imports
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
        const width = el.clientWidth || 640;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(width, height);
        const canvas: HTMLCanvasElement = renderer.domElement; canvas.tabIndex = 0; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', asset.alt_text); el.appendChild(canvas);
        const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(asset.kind === 'panorama_360' ? 75 : 45, width / height, 0.01, 2000);
        const controls = new OrbitControls(camera, canvas); controls.listenToKeyEvents(canvas as any);
        let label = '';
        if (asset.kind === 'model_3d') {
          // @ts-ignore
          const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
          scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2)); const dir = new THREE.DirectionalLight(0xffffff, 1.5); dir.position.set(3, 5, 4); scene.add(dir);
          const gltf = await new GLTFLoader().loadAsync(asset.url); if (gone) { renderer.dispose(); return; }
          const box = new THREE.Box3().setFromObject(gltf.scene); const size = box.getSize(new THREE.Vector3()).length() || 1; const c = box.getCenter(new THREE.Vector3());
          gltf.scene.position.sub(c); scene.add(gltf.scene); camera.position.set(0, size * 0.3, size * 1.2); controls.update();
          label = 'orbit_3d';
          if (await xrSupported('immersive-ar')) {
            // @ts-ignore
            const { ARButton } = await import('three/examples/jsm/webxr/ARButton.js'); renderer.xr.enabled = true; el.appendChild(ARButton.createButton(renderer)); label = 'ar';
          }
        } else {
          const tex = await new THREE.TextureLoader().loadAsync(asset.url); if (gone) { renderer.dispose(); return; }
          tex.colorSpace = THREE.SRGBColorSpace; const geo = new THREE.SphereGeometry(500, 60, 40); geo.scale(-1, 1, 1);
          scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }))); camera.position.set(0, 0, 0.1); controls.enableZoom = false; controls.enablePan = false; controls.rotateSpeed = -0.4; controls.update();
          label = 'panorama_drag';
          if (await xrSupported('immersive-vr')) {
            // @ts-ignore
            const { VRButton } = await import('three/examples/jsm/webxr/VRButton.js'); renderer.xr.enabled = true; el.appendChild(VRButton.createButton(renderer)); label = 'vr';
          }
        }
        setMode(label);
        renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
        stop = () => { renderer.setAnimationLoop(null); controls.dispose(); renderer.dispose(); el.replaceChildren(); };
      } catch { setErr('Impossible de charger ce contenu 3D. / Unable to load this 3D content.'); setMode('image_only'); }
    })();
    return () => { gone = true; stop(); };
  }, [asset.id, asset.url, asset.kind, asset.alt_text, height]);
  const labels: Record<string, string> = { ar: 'Réalité augmentée disponible (bouton ci-dessous)', vr: 'Casque VR disponible (bouton ci-dessous)', orbit_3d: 'Vue 3D : glisser pour tourner, flèches du clavier', panorama_drag: 'Vue 360° : glisser ou flèches du clavier pour regarder autour' };
  return (
    <figure>
      <div ref={host} style={{ maxWidth: '100%' }} />
      {mode === 'image_only' && (asset.kind === 'panorama_360'
        ? <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}><img src={asset.url} alt={asset.alt_text} style={{ height, maxWidth: 'none' }} /></div>
        : <p>{asset.alt_text}</p>)}
      <figcaption>{asset.title} — <span role="status">{err || labels[mode] || (mode === 'image_only' ? 'Affichage simplifié (appareil sans 3D)' : mode)}</span></figcaption>
    </figure>
  );
}
