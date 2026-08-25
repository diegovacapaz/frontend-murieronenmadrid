import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalsService } from '../../globals/globals.service';
import { NewsletterService } from './newsletter.service';

/**
 * El disparador de las 5 de la mañana.
 *
 * La zona va explícita y no como `'0 8 * * *'` sobre el proceso en UTC
 * (`timezone-bootstrap.ts` fija `process.env.TZ = 'UTC'`): dice lo que quiere
 * decir, y si algún día Argentina vuelve al horario de verano no hay que
 * acordarse de este archivo.
 *
 * Un solo reintento inmediato. Si el segundo también falla se loguea y se va a
 * dormir: el puntero no se movió, así que mañana lo intenta de nuevo con el
 * mismo material y no se perdió nada.
 */
@Injectable()
export class NewsletterCron {
  private readonly logger = new Logger(NewsletterCron.name);

  constructor(
    private readonly newsletterService: NewsletterService,
    private readonly globals: GlobalsService,
  ) {}

  @Cron('0 5 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async publicar(): Promise<void> {
    // El corte a nivel proceso. Si está en false, ni siquiera se lee la
    // configuración de la base: sirve para levantar una copia del backend sin
    // que empiece a gastar plata.
    if (this.globals.get('NEWSLETTER_ENABLED') !== 'true') return;

    for (const intento of [1, 2]) {
      try {
        const edicion = await this.newsletterService.publicarSiHayNovedades();
        if (edicion) {
          this.logger.log(
            `MurieronNews Nº ${edicion.editionNumber}: ${edicion.articles.length} notas`,
          );
        }
        return;
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        this.logger.error(`Intento ${intento} fallido: ${mensaje}`);
      }
    }

    this.logger.error('Los dos intentos fallaron. El puntero no se movió; mañana se reintenta.');
  }
}
