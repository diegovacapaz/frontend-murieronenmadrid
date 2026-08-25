import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DossierBuilder } from './dossier.builder';
import { NewsletterClient } from './newsletter.client';
import { NEWSLETTER_REPOSITORY } from './newsletter.constants';
import { NewsletterController } from './newsletter.controller';
import { NewsletterCron } from './newsletter.cron';
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
    // El cliente se inyecta por clase, igual que el builder: no es un
    // repositorio y no hay una segunda implementación que justifique un token.
    // GlobalsService, lo único que pide, viene del GlobalsModule que es @Global.
    NewsletterClient,
    // El cron nace acá y no se exporta: nadie más lo inyecta. Necesita estar
    // en algún módulo para que Nest lo instancie y el `@Cron` de adentro se
    // registre en el SchedulerRegistry que trae ScheduleModule.forRoot().
    NewsletterCron,
  ],
  exports: [NewsletterService, DossierBuilder, NewsletterClient],
})
export class NewsletterModule {}
