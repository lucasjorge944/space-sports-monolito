'use client';

import {
  getGetMeQueryKey,
  isApiError,
  type MeResponseDto,
  useCreateMyAvatarUpload,
  useDeleteMyAvatar,
  useSetMyAvatar,
} from '@space-sports/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/painel/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AVATAR_ERROR_MESSAGES,
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  type AvatarType,
  validateAvatarSource,
} from '@/lib/account/avatar';
import { apiErrorMessage } from '@/lib/painel/errors';
import { AvatarCropDialog } from './avatar-crop-dialog';
import { UserAvatar } from './user-avatar';

const STORAGE_FAILED = 'storage';

function avatarErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === STORAGE_FAILED) {
    return 'O envio ao armazenamento falhou. Tente de novo.';
  }
  if (isApiError(error)) {
    const known = AVATAR_ERROR_MESSAGES[error.code];
    if (known) return known;
    if (error.status === 503) return AVATAR_ERROR_MESSAGES.STORAGE_UNAVAILABLE as string;
    if (error.status === 429) return AVATAR_ERROR_MESSAGES.TOO_MANY_REQUESTS as string;
  }
  return apiErrorMessage(error);
}

/**
 * Foto de perfil (RF-AUTH-02, decisões 67 e 71): escolher, recortar o quadrado, enviar, trocar e
 * remover. Mesmo fluxo da logo do espaço: `POST /v1/me/avatar/uploads` → PUT direto no storage (a URL
 * vale 5 minutos, por isso só é pedida na hora de enviar) → `PUT /v1/me/avatar`.
 */
export function AvatarCard({ me }: { me: MeResponseDto }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<File | null>(null);
  const [pickError, setPickError] = useState<string>();
  const [uploadError, setUploadError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const requestUpload = useCreateMyAvatarUpload();
  const setAvatar = useSetMyAvatar();
  const remove = useDeleteMyAvatar();

  function choose(files: FileList | null) {
    const file = files?.[0];
    if (input.current) input.current.value = '';
    if (!file) return;
    const invalid = validateAvatarSource(file);
    setPickError(invalid ?? undefined);
    setUploadError(undefined);
    if (!invalid) setSource(file);
  }

  async function upload(cropped: File) {
    if (cropped.size > AVATAR_MAX_BYTES) {
      setUploadError(AVATAR_ERROR_MESSAGES.IMAGE_TOO_LARGE);
      return;
    }
    setUploading(true);
    setUploadError(undefined);
    try {
      const target = await requestUpload.mutateAsync({
        data: { contentType: cropped.type as AvatarType, size: cropped.size },
      });
      // Envio direto ao storage (URL pré-assinada), fora da API.
      const put = await fetch(target.uploadUrl, {
        method: target.method,
        headers: target.headers,
        body: cropped,
      });
      if (!put.ok) throw new Error(STORAGE_FAILED);
      await setAvatar.mutateAsync({ data: { key: target.key } });
      toast.success(me.avatarUrl ? 'Foto trocada.' : 'Foto adicionada.');
      setSource(null);
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (error) {
      setUploadError(avatarErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card data-testid="avatar-card">
      <CardHeader>
        <CardTitle>Foto</CardTitle>
        <CardDescription>
          JPEG, PNG ou WebP. Você escolhe o recorte quadrado antes de enviar. Sem foto, usamos as
          iniciais do seu nome.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <UserAvatar name={me.name} avatarUrl={me.avatarUrl} size={96} />
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="file"
              accept={AVATAR_TYPES.join(',')}
              hidden
              data-testid="avatar-input"
              onChange={(event) => choose(event.target.files)}
            />
            <Button variant="outline" onClick={() => input.current?.click()}>
              <ImagePlus />
              {me.avatarUrl ? 'Trocar foto' : 'Enviar foto'}
            </Button>
            {me.avatarUrl ? (
              <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
                <Trash2 />
                Remover
              </Button>
            ) : null}
          </div>
        </div>
        {pickError ? (
          <p className="text-destructive text-sm" role="alert">
            {pickError}
          </p>
        ) : null}
      </CardContent>

      <AvatarCropDialog
        file={source}
        pending={uploading}
        error={uploadError}
        onCancel={() => {
          setSource(null);
          setUploadError(undefined);
        }}
        onConfirm={(cropped) => void upload(cropped)}
      />

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remover foto"
        description="Seu perfil volta a mostrar as iniciais do nome no app e no painel."
        confirmLabel="Remover"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              setConfirmRemove(false);
              toast.success('Foto removida.');
              queryClient.setQueryData<MeResponseDto>(getGetMeQueryKey(), (current) =>
                current ? { ...current, avatarUrl: null } : current,
              );
            },
          })
        }
      />
    </Card>
  );
}
