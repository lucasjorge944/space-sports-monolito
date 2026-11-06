import { Module } from '@nestjs/common';
import { AddressController } from './address.controller.js';
import { CepLookupService } from './cep-lookup.service.js';

/** Endereços: busca por CEP (decisão 52). */
@Module({
  controllers: [AddressController],
  providers: [CepLookupService],
})
export class AddressModule {}
