'use client';

import {
  type ManagedSpace,
  useAddSpacePhoto,
  useCreateSpacePhotoUpload,
  useDeleteSpacePhoto,
  useGetManagedSpace,
  useReorderSpacePhotos,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Star, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { ReadOnlyNotice, SpaceGate, type SpaceScope } from '@/components/painel/space-scope';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/painel/states';
import { Button } from '@/components/ui/button';
import { apiErrorMessage } from '@/lib/painel/errors';
import { MAX_PHOTOS, moveItem, validatePhotoFile } from '@/lib/painel/photos';
import { invalidateSpace } from '@/lib/painel/query';

export function FotosView() {
  return <SpaceGate permission="schedule.view">{(scope) => <Fotos scope={scope} />}</SpaceGate>;
}

function Fotos({ scope }: { scope: SpaceScope }) {
  const query = useGetManagedSpace(scope.spaceId);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fotos"
        description="A primeira foto é a capa na vitrine do app. Até 20 fotos de até 10 MB."
      />
      <ReadOnlyNotice scope={scope} />
      {query.isPending ? (
        <LoadingBlock rows={3} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Gallery scope={scope} space={query.data} />
      )}
    </div>
  );
}

function Gallery({ scope, space }: { scope: SpaceScope; space: ManagedSpace }) {
  const queryClient = useQueryClient();
  const editable = scope.canWrite('space.edit');
  const photos = [...space.photos].sort((a, b) => a.position - b.position);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const requestUpload = useCreateSpacePhotoUpload();
  const addPhoto = useAddSpacePhoto();
  const reorder = useReorderSpacePhotos();
  const remove = useDeleteSpacePhoto();

  const refresh = () => invalidateSpace(queryClient, scope.spaceId);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let sent = 0;
    try {
      for (const file of Array.from(files)) {
        if (photos.length + sent >= MAX_PHOTOS) {
          toast.error(`O espaço já tem o máximo de ${MAX_PHOTOS} fotos.`);
          break;
        }
        const invalid = validatePhotoFile(file);
        if (invalid) {
          toast.error(`${file.name}: ${invalid}`);
          continue;
        }
        try {
          const target = await requestUpload.mutateAsync({
            spaceId: scope.spaceId,
            data: {
              contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
              size: file.size,
            },
          });
          // Envio direto ao storage (URL pré-assinada), fora da API.
          const put = await fetch(target.uploadUrl, {
            method: target.method,
            headers: target.headers,
            body: file,
          });
          if (!put.ok) throw new Error('storage');
          await addPhoto.mutateAsync({ spaceId: scope.spaceId, data: { key: target.key } });
          sent += 1;
        } catch (error) {
          toast.error(
            `${file.name}: ${error instanceof Error && error.message === 'storage' ? 'o envio ao armazenamento falhou. Tente de novo.' : apiErrorMessage(error)}`,
          );
        }
      }
      if (sent > 0) toast.success(sent === 1 ? 'Foto adicionada.' : `${sent} fotos adicionadas.`);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
      void refresh();
    }
  }

  function move(index: number, to: number) {
    const ids = moveItem(
      photos.map((p) => p.id),
      index,
      to,
    );
    reorder.mutate(
      { spaceId: scope.spaceId, data: { photoIds: ids } },
      {
        onSuccess: () => void refresh(),
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {editable ? (
        <div>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            data-testid="photo-input"
            onChange={(e) => void upload(e.target.files)}
          />
          <Button
            onClick={() => input.current?.click()}
            disabled={uploading || photos.length >= MAX_PHOTOS}
          >
            {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <ImagePlus />}
            {uploading ? 'Enviando…' : 'Adicionar fotos'}
          </Button>
        </div>
      ) : null}

      {photos.length === 0 ? (
        <EmptyState
          title="Nenhuma foto ainda"
          description="Espaços com fotos chamam mais atenção na vitrine do app."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="photo-list">
          {photos.map((photo, index) => (
            <li key={photo.id} className="overflow-hidden rounded-lg border">
              {/* biome-ignore lint/performance/noImgElement: URLs externas do storage, sem otimização do Next */}
              <img
                src={photo.url}
                alt={`Foto ${index + 1} do espaço`}
                className="aspect-[4/3] w-full object-cover"
                loading="lazy"
              />
              <div className="flex items-center justify-between gap-2 p-2">
                <span className="text-muted-foreground flex items-center gap-1 text-xs">
                  {index === 0 ? (
                    <>
                      <Star className="size-3" aria-hidden /> Capa
                    </>
                  ) : (
                    `Foto ${index + 1}`
                  )}
                </span>
                {editable ? (
                  <div className="flex gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Mover para antes"
                      disabled={index === 0 || reorder.isPending}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowLeft />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Mover para depois"
                      disabled={index === photos.length - 1 || reorder.isPending}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowRight />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Remover foto"
                      onClick={() => setRemoveId(photo.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removeId !== null}
        onOpenChange={(open) => !open && setRemoveId(null)}
        title="Remover foto"
        description="A foto sai da galeria e da página pública do espaço."
        confirmLabel="Remover"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (!removeId) return;
          remove.mutate(
            { spaceId: scope.spaceId, photoId: removeId },
            {
              onSuccess: () => {
                setRemoveId(null);
                toast.success('Foto removida.');
                void refresh();
              },
            },
          );
        }}
      />
    </div>
  );
}
