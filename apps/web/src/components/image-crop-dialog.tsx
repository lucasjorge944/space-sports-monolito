'use client';

import { Loader2 } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { FormError } from '@/components/auth/form-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  CROP_MAX_ZOOM,
  type CropBox,
  cropBox,
  type Pan,
  panAfterDragBox,
  type Size,
} from '@/lib/image-crop';
import { cn } from '@/lib/utils';

const CENTER: Pan = { x: 0, y: 0 };

/** Posição do recorte em texto, para o leitor de tela: `-1..1` → `0%..100%` a partir da borda. */
function positionText(value: number, from: string): string {
  return value === 0 ? 'Centro' : `${Math.round((value + 1) * 50)}% ${from}`;
}

/** Controle deslizante nativo (teclado e leitor de tela de graça), com o rótulo acima. */
function RangeControl({
  id,
  label,
  min,
  max,
  value,
  valueText,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  valueText: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        aria-valuetext={valueText}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-primary w-full disabled:opacity-50"
      />
    </div>
  );
}

export type ImageCropDialogProps = {
  file: File | null;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
  pending: boolean;
  error: string | undefined;
  /** Proporção do recorte (largura ÷ altura): 1 na foto de perfil, 2 no banner, 0.8 no card. */
  aspect: number;
  /** Círculo (foto de perfil) ou o próprio retângulo marcado (peça de anúncio). */
  frame: 'circle' | 'rect';
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Prefixo dos ids dos controles e `data-testid` do quadro. */
  idPrefix: string;
  /** Gera o arquivo final a partir do recorte escolhido. */
  render: (image: HTMLImageElement, box: CropBox, sourceType: string) => Promise<File>;
  /** Problema do recorte atual (ex.: menor que o mínimo da vaga): aparece e bloqueia o envio. */
  checkCrop?: (box: CropBox) => string | null;
  /** Texto abaixo dos controles (ex.: tamanho do recorte). */
  footnote?: (box: CropBox) => ReactNode;
  /**
   * Mensagem para a falha de `render` (ex.: arquivo grande demais). A imagem foi lida, então os
   * controles continuam na tela para ajustar o recorte e tentar de novo.
   */
  renderErrorMessage?: (error: unknown) => string;
};

const RENDER_ERROR =
  'Não foi possível gerar a imagem recortada. Tente de novo ou use outro arquivo.';

/**
 * Recorte de imagem no navegador numa proporção fixa: arrastar (ou os controles) move, o zoom
 * aproxima. Confirmar gera o arquivo e entrega a `onConfirm`, que faz o envio; o erro do envio
 * aparece aqui mesmo, para tentar de novo sem escolher o arquivo outra vez. Usado pela foto de
 * perfil (decisão 67) e pelas peças de anúncio do /super (RF-ADS-03).
 */
export function ImageCropDialog({
  file,
  onCancel,
  onConfirm,
  pending,
  error,
  aspect,
  frame,
  title,
  description,
  confirmLabel,
  idPrefix,
  render,
  checkCrop,
  footnote,
  renderErrorMessage,
}: ImageCropDialogProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>(CENTER);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string>();

  // Carrega a imagem escolhida; cada arquivo novo começa centralizado e sem zoom.
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    setSize(null);
    setLoadError(false);
    setRenderError(undefined);
    setZoom(1);
    setPan(CENTER);
    img.onload = () => {
      image.current = img;
      setSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => setLoadError(true);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Prévia: o mesmo recorte que será enviado, desenhado no quadro.
  useEffect(() => {
    const target = canvas.current;
    const img = image.current;
    if (!target || !img || !size) return;
    const width = target.clientWidth || 288;
    const height = width / aspect;
    const ratio = window.devicePixelRatio || 1;
    target.width = Math.round(width * ratio);
    target.height = Math.round(height * ratio);
    const context = target.getContext('2d');
    if (!context) return;
    const box = cropBox(size, aspect, zoom, pan);
    // Recorte novo, arquivo novo: a falha da geração anterior não vale mais.
    setRenderError(undefined);
    context.clearRect(0, 0, target.width, target.height);
    context.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, target.width, target.height);
  }, [size, zoom, pan, aspect]);

  function move(dx: number, dy: number) {
    if (!size) return;
    const viewport = canvas.current?.clientWidth || 288;
    setPan((current) => panAfterDragBox(size, aspect, zoom, current, { dx, dy }, viewport));
  }

  const box = size ? cropBox(size, aspect, zoom, pan) : null;
  const cropProblem = box && checkCrop ? checkCrop(box) : null;

  async function confirm() {
    if (!file || !image.current || !box || cropProblem) return;
    setRendering(true);
    setRenderError(undefined);
    try {
      onConfirm(await render(image.current, box, file.type));
    } catch (failure) {
      setRenderError(renderErrorMessage?.(failure) ?? RENDER_ERROR);
    } finally {
      setRendering(false);
    }
  }

  const busy = pending || rendering;
  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className={frame === 'circle' ? 'sm:max-w-md' : 'sm:max-w-xl'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {loadError ? (
          <FormError message="Não foi possível ler a imagem. Use JPEG, PNG ou WebP." />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div
              className={cn('relative w-full', frame === 'circle' ? 'max-w-72' : 'max-w-md')}
              style={{ aspectRatio: aspect }}
            >
              {size ? null : (
                <div className="bg-muted absolute inset-0 flex items-center justify-center rounded-md">
                  <Loader2 className="text-muted-foreground animate-spin" aria-hidden />
                </div>
              )}
              {/* Arrastar é atalho do mouse e do toque; teclado e leitor de tela usam os controles abaixo. */}
              <canvas
                ref={canvas}
                data-testid={`${idPrefix}-crop`}
                aria-hidden
                className="bg-muted size-full cursor-grab touch-none rounded-md border active:cursor-grabbing"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = { x: event.clientX, y: event.clientY };
                }}
                onPointerMove={(event) => {
                  if (!drag.current) return;
                  move(event.clientX - drag.current.x, event.clientY - drag.current.y);
                  drag.current = { x: event.clientX, y: event.clientY };
                }}
                onPointerUp={() => {
                  drag.current = null;
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
              />
              <div
                aria-hidden
                className={cn(
                  'ring-primary pointer-events-none absolute inset-0 ring-2',
                  frame === 'circle' ? 'rounded-full' : 'rounded-md',
                )}
              />
            </div>
            <div className={cn('grid w-full gap-3', frame === 'circle' ? 'max-w-72' : 'max-w-md')}>
              <RangeControl
                id={`${idPrefix}-zoom`}
                label="Zoom"
                min={1}
                max={CROP_MAX_ZOOM}
                value={zoom}
                valueText={`${Math.round(zoom * 100)}%`}
                disabled={!size}
                onChange={setZoom}
              />
              <RangeControl
                id={`${idPrefix}-pan-x`}
                label="Posição horizontal"
                min={-1}
                max={1}
                value={pan.x}
                valueText={positionText(pan.x, 'da esquerda')}
                // Sem sobra da imagem neste eixo (ex.: foto já na proporção, sem zoom), não há o que mover.
                disabled={!size || !box || size.width - box.width < 1}
                onChange={(x) => setPan((current) => ({ ...current, x }))}
              />
              <RangeControl
                id={`${idPrefix}-pan-y`}
                label="Posição vertical"
                min={-1}
                max={1}
                value={pan.y}
                valueText={positionText(pan.y, 'do topo')}
                disabled={!size || !box || size.height - box.height < 1}
                onChange={(y) => setPan((current) => ({ ...current, y }))}
              />
              {box && footnote ? (
                <p className="text-muted-foreground text-helper">{footnote(box)}</p>
              ) : null}
            </div>
          </div>
        )}

        <FormError message={cropProblem ?? renderError ?? error} />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={busy || !size || loadError || Boolean(cropProblem)}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {busy ? 'Enviando…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
