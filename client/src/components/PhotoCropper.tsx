import { useEffect, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { RotateCw, X } from 'lucide-react';
import { useEditor } from '../store';
import { api } from '../api';
import { resolveTheme } from '../lib/themes';

const OUTPUT = 600; // px: nítido al imprimir en tarjeta y liviano (~40-70 KB en WebP)

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen (¿formato HEIC? conviértela a JPG)'));
    img.src = src;
  });
}

/** Recorta (con rotación) a un cuadrado de OUTPUT px y lo comprime a WebP en el navegador. */
async function cropToBlob(src: string, area: Area, rotation: number): Promise<Blob> {
  const img = await loadImage(src);
  const rad = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const bw = img.width * cos + img.height * sin;
  const bh = img.width * sin + img.height * cos;

  const rotated = document.createElement('canvas');
  rotated.width = bw;
  rotated.height = bh;
  const rctx = rotated.getContext('2d')!;
  rctx.translate(bw / 2, bh / 2);
  rctx.rotate(rad);
  rctx.drawImage(img, -img.width / 2, -img.height / 2);

  const out = document.createElement('canvas');
  out.width = OUTPUT;
  out.height = OUTPUT;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(rotated, area.x, area.y, area.width, area.height, 0, 0, OUTPUT, OUTPUT);

  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), 'image/webp', 0.86),
  );
}

export function PhotoCropper() {
  const target = useEditor((s) => s.cropTarget);
  const set = useEditor((s) => s.set);
  const updatePerson = useEditor((s) => s.updatePerson);
  const toast = useEditor((s) => s.toast);
  const shape = useEditor((s) => resolveTheme(s.tree?.theme).photoShape);
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    const url = URL.createObjectURL(target.file);
    setSrc(url);
    setZoom(1);
    setRotation(0);
    setCrop({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(url);
  }, [target]);

  if (!target || !src) return null;
  const close = () => set({ cropTarget: null });

  const save = async () => {
    if (!area) return;
    setBusy(true);
    try {
      const blob = await cropToBlob(src, area, rotation);
      const { url } = await api.uploadPhoto(blob);
      await updatePerson(target.personId, { photoUrl: url });
      close();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onMouseDown={close}>
      <div className="modal cropper-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h3>Ajustar foto</h3>
          <button className="icon-btn" onClick={close}><X size={18} /></button>
        </header>
        <div className="crop-area">
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            rotation={rotation}
            aspect={1}
            cropShape={shape === 'circle' ? 'round' : 'rect'}
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onRotationChange={setRotation}
            onCropComplete={(_, px) => setArea(px)}
            maxZoom={5}
          />
        </div>
        <div className="crop-controls">
          <label>
            Zoom
            <input type="range" min={1} max={5} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
          <label>
            Giro
            <input type="range" min={-180} max={180} step={1} value={rotation} onChange={(e) => setRotation(Number(e.target.value))} />
          </label>
          <button className="icon-btn" title="Girar 90°" onClick={() => setRotation((r) => ((r + 90 + 180) % 360) - 180)}>
            <RotateCw size={16} />
          </button>
        </div>
        <p className="hint">Arrastra para encuadrar la cara; usa la rueda del ratón o el control para acercar.</p>
        <footer>
          <button className="btn ghost" onClick={close}>Cancelar</button>
          <button className="btn primary" disabled={busy || !area} onClick={save}>
            {busy ? 'Guardando…' : 'Guardar foto'}
          </button>
        </footer>
      </div>
    </div>
  );
}
