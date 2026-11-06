import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/env.module.js';
import { PhotoStorage } from './photo-storage.js';
import { createPhotoStorage } from './s3-photo-storage.js';

/**
 * Storage das fotos (S3, decisão 72), compartilhado pelos espaços (galeria e logo), pela foto de
 * perfil e pela exclusão de conta. Nos testes, `PhotoStorage` é trocado por um fake.
 */
@Global()
@Module({
  providers: [{ provide: PhotoStorage, inject: [ENV], useFactory: createPhotoStorage }],
  exports: [PhotoStorage],
})
export class StorageModule {}
