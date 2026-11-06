'use client';

import {
  getGetMeQueryKey,
  type ManagedSpace,
  useCreateSpaceLogoUpload,
  useDeleteSpaceLogo,
  useSetSpaceLogo,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import type { SpaceScope } from '@/components/painel/space-scope';
import { SpaceAvatar } from '@/components/space-avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiErrorMessage } from '@/lib/painel/errors';
import {
  LOGO_TYPES,
  type LogoType,
  readImageSize,
  validateLogoDimensions,
  validateLogoFile,
} from '@/lib/painel/logo';
import { invalidateSpace } from '@/lib/painel/query';

type Picked = { file: File; previewUrl: string };

/** Logo do espaço (RF-SPACE-11): escolher, ver a prévia, enviar, trocar e remover. */
export function LogoCard({ scope, space }: { scope: SpaceScope; space: ManagedSpace }) {
  const queryClient = useQueryClient();
  const editable = scope.canWrite('space.edit');
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const requestUpload = useCreateSpaceLogoUpload();
  const setLogo = useSetSpaceLogo();
  const remove = useDeleteSpaceLogo();

  // Libera a URL local da prévia ao trocar de arquivo ou sair da tela.
  useEffect(() => {
    return () => {
      if (picked) URL.revokeObjectURL(picked.previewUrl);
    };
  }, [picked]);

  async function choose(files: FileList | null) {
    const file = files?.[0];
    if (input.current) input.current.value = '';
    if (!file) return;
    setError(null);
    const invalid = validateLogoFile(file);
    if (invalid) {
      setPicked(null);
      setError(invalid);
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    try {
      const notSquare = validateLogoDimensions(await readImageSize(previewUrl));
      if (notSquare) {
        URL.revokeObjectURL(previewUrl);
        setPicked(null);
        setError(notSquare);
        return;
      }
    } catch {
      URL.revokeObjectURL(previewUrl);
      setPicked(null);
      setError('Não foi possível ler a imagem. Use JPEG, PNG ou WebP');
      return;
    }
    setPicked({ file, previewUrl });
  }

  async function send() {
    if (!picked) return;
    setUploading(true);
    setError(null);
    try {
      const target = await requestUpload.mutateAsync({
        spaceId: scope.spaceId,
        data: { contentType: picked.file.type as LogoType, size: picked.file.size },
      });
      // Envio direto ao storage (URL pré-assinada), fora da API.
      const put = await fetch(target.uploadUrl, {
        method: target.method,
        headers: target.headers,
        body: picked.file,
      });
      if (!put.ok) throw new Error('storage');
      await setLogo.mutateAsync({ spaceId: scope.spaceId, data: { key: target.key } });
      toast.success(space.logoUrl ? 'Logo trocada.' : 'Logo adicionada.');
      setPicked(null);
      void invalidateSpace(queryClient, scope.spaceId);
      // A logo também aparece no seletor de espaço (`/v1/me`).
      void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (e) {
      setError(
        e instanceof Error && e.message === 'storage'
          ? 'O envio ao armazenamento falhou. Tente de novo.'
          : apiErrorMessage(e),
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card data-testid="logo-card">
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>
          Imagem quadrada (mesma largura e altura), JPEG, PNG ou WebP, de até 2 MB. Aparece no
          seletor de espaço, na vitrine do app e na página pública. Sem logo, usamos as iniciais do
          nome.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          {picked ? (
            <div className="flex items-center gap-3">
              {/* biome-ignore lint/performance/noImgElement: prévia local (blob), sem otimização do Next */}
              <img
                src={picked.previewUrl}
                alt="Prévia da nova logo"
                className="border-border size-24 rounded-full border object-cover"
                data-testid="logo-preview"
              />
              <p className="text-muted-foreground max-w-48 text-sm">
                Prévia da nova logo. Ela só vale depois de enviada.
              </p>
            </div>
          ) : (
            <SpaceAvatar name={space.name} logoUrl={space.logoUrl} size={96} />
          )}

          {editable ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={input}
                type="file"
                accept={LOGO_TYPES.join(',')}
                hidden
                data-testid="logo-input"
                onChange={(e) => void choose(e.target.files)}
              />
              {picked ? (
                <>
                  <Button onClick={() => void send()} disabled={uploading}>
                    {uploading ? <Loader2 className="animate-spin" aria-hidden /> : null}
                    {uploading ? 'Enviando…' : 'Enviar logo'}
                  </Button>
                  <Button variant="outline" onClick={() => setPicked(null)} disabled={uploading}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => input.current?.click()}>
                    <ImagePlus />
                    {space.logoUrl ? 'Trocar logo' : 'Enviar logo'}
                  </Button>
                  {space.logoUrl ? (
                    <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
                      <Trash2 />
                      Remover
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="text-destructive text-sm" role="alert" data-testid="logo-error">
            {error}
          </p>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remover logo"
        description="O espaço volta a mostrar as iniciais do nome no app, no painel e na página pública."
        confirmLabel="Remover"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          remove.mutate(
            { spaceId: scope.spaceId },
            {
              onSuccess: () => {
                setConfirmRemove(false);
                toast.success('Logo removida.');
                void invalidateSpace(queryClient, scope.spaceId);
                void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
              },
            },
          )
        }
      />
    </Card>
  );
}
