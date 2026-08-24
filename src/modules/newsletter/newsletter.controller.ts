import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiRoute, ApiTag } from '../../common/constants';
import { ParseIsoDatePipe } from '../../common/pipes/parse-iso-date.pipe';
import { EditionResponseDto, EditionSummaryDto } from './dto/edition-response.dto';
import { NewsletterService } from './newsletter.service';

@ApiTags(ApiTag.NEWSLETTER)
@Controller(ApiRoute.NEWSLETTER)
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Get('editions')
  @ApiOperation({
    summary: 'El archivo del diario',
    description:
      'Una fila por edición con el titular de su portada, de la más nueva a la ' +
      'más vieja. Sin los cuerpos de las notas.',
  })
  findArchive(): Promise<EditionSummaryDto[]> {
    return this.newsletterService.findArchive();
  }

  // Va ANTES de 'editions/:date': si estuviera después, Express le daría
  // "latest" al parámetro y el pipe lo rechazaría con un 400.
  @Get('editions/latest')
  @ApiOperation({
    summary: 'La última edición',
    description:
      'Devuelve `null` —no un 404— cuando el diario todavía no publicó ninguna ' +
      'edición: es el estado inicial del sistema y el frontend dibuja el vacío.',
  })
  findLatest(): Promise<EditionResponseDto | null> {
    return this.newsletterService.findLatest();
  }

  @Get('editions/:date')
  @ApiOperation({ summary: 'Una edición por fecha (YYYY-MM-DD)' })
  @ApiResponse({ status: 400, description: 'La fecha no tiene formato YYYY-MM-DD' })
  @ApiResponse({ status: 404, description: 'No hubo edición ese día' })
  findByDate(@Param('date', ParseIsoDatePipe) date: string): Promise<EditionResponseDto> {
    return this.newsletterService.findByDate(date);
  }
}
