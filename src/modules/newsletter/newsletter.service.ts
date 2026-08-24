import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppErrorCode } from '../../common/constants/error-codes.constants';
import {
  EditionResponseDto,
  EditionSummaryDto,
} from './dto/edition-response.dto';
import type { INewsletterRepository } from './interfaces/newsletter.repository.interface';
import { NEWSLETTER_REPOSITORY } from './newsletter.constants';

/**
 * No calcula nada: delega en el repositorio y decide qué significa "no hay".
 *
 * Y significa dos cosas distintas. Pedir la última edición de un diario que
 * todavía no publicó nada no es un error: es el estado inicial del sistema, y
 * la respuesta es `null` para que el frontend dibuje el cartel de "todavía no
 * salió el primer número". Pedir una fecha puntual que no existe sí es un 404:
 * ahí el cliente pidió algo concreto que no está.
 */
@Injectable()
export class NewsletterService {
  constructor(
    @Inject(NEWSLETTER_REPOSITORY)
    private readonly newsletterRepository: INewsletterRepository,
  ) {}

  async findLatest(): Promise<EditionResponseDto | null> {
    return this.newsletterRepository.findLatest();
  }

  async findByDate(date: string): Promise<EditionResponseDto> {
    const edition = await this.newsletterRepository.findByDate(date);

    if (!edition) {
      throw new NotFoundException({
        message: 'Edition not found',
        errorCode: AppErrorCode.NEWSLETTER_EDITION_NOT_FOUND,
      });
    }

    return edition;
  }

  async findArchive(): Promise<EditionSummaryDto[]> {
    return this.newsletterRepository.findArchive();
  }
}
