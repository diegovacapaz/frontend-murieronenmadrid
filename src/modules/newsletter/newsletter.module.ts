import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DossierBuilder } from './dossier.builder';
import { NEWSLETTER_REPOSITORY } from './newsletter.constants';
import { NewsletterController } from './newsletter.controller';
import { NewsletterRepository } from './newsletter.repository';
import { NewsletterService } from './newsletter.service';

@Module({
  imports: [DatabaseModule],
  controllers: [NewsletterController],
  providers: [
    { provide: NEWSLETTER_REPOSITORY, useClass: NewsletterRepository },
    NewsletterService,
    // El builder no va detrás del token del repositorio a propósito: no es un
    // repositorio. No lee una tabla del módulo para devolver entidades, sino
    // que orquesta ~60 llamadas a los procedures de otros módulos y arma con
    // eso el input del modelo. Se inyecta por clase, como el service.
    DossierBuilder,
  ],
  exports: [NewsletterService, DossierBuilder],
})
export class NewsletterModule {}
