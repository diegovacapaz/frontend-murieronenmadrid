import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminOnly } from '../../auth/decorators/admin-only.decorator';
import { ApiRoute, ApiTag } from '../../common/constants';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ParseIsoDatePipe } from '../../common/pipes/parse-iso-date.pipe';
import { ArticleDto, EditionResponseDto, EditionSummaryDto } from './dto/edition-response.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { ConfigResponseDto, UpdateConfigDto } from './dto/update-config.dto';
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
  // El @ApiOkResponse es obligatorio acá y no en los otros dos: el plugin CLI
  // de Swagger no infiere el tipo de una unión con `null`, y sin esta línea el
  // `data` del endpoint que más usa el frontend sale como un `object` pelado en
  // vez de resolver el $ref a EditionResponseDto.
  @ApiOkResponse({
    type: EditionResponseDto,
    description: 'La última edición, o `null` si todavía no hay ediciones.',
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

  /**
   * Dispara una edición a mano. Pedido de Diego: poder ver el diario andando el
   * día del deploy en vez de esperar a la madrugada.
   *
   * OJO CON EL TIEMPO: la generación tarda entre 8 y 14 minutos —el turno más
   * largo medido fue 844 s— y eso excede el timeout de cualquier proxy. El
   * endpoint NO puede devolver la edición terminada.
   *
   * Responde 202 y sigue en segundo plano; el frontend se entera por el evento
   * `newsletter:published` del socket, que ya existe y ya invalida la solapa.
   * Un botón que se queda diez minutos girando y termina en un 504 es peor que
   * no tener botón.
   */
  @Post('editions/generate')
  @ApiOperation({
    summary: 'Generar una edición ahora (solo admin)',
    description:
      'Publica una edición sin esperar al cron, haya o no partidos nuevos. Si no ' +
      'hay ninguna edición previa, sale la inaugural: presenta el estado del ' +
      'mundo y deja el snapshot con el que van a comparar las siguientes. ' +
      'Tarda entre 8 y 14 minutos: responde 202 y avisa por socket al terminar.',
  })
  @ApiResponse({ status: 202, description: 'Generación encolada' })
  @ApiResponse({ status: 409, description: 'Ya hay una generación en curso' })
  @ApiBearerAuth()
  @ResponseMessage('Generando la edición. Va a aparecer sola cuando esté.')
  @HttpCode(202)
  generateNow(): void {
    this.newsletterService.publicarAhoraEnSegundoPlano();
  }

  @Post('editions/:date/regenerate')
  @ApiOperation({
    summary: 'Regenerar una edición',
    description:
      'Reescribe todas las notas de esa fecha. Usa el snapshot de la edición ' +
      'anterior como "antes" y el estado de ahora como "después", así que si en ' +
      'el medio se cargó otro partido la edición nueva también va a hablar de ' +
      'ese. Las notas editadas a mano se pierden. El número de edición no cambia.',
  })
  @ApiResponse({ status: 404, description: 'No hubo edición ese día' })
  @ApiBearerAuth()
  @ResponseMessage('Edición regenerada')
  regenerate(
    @Param('date', ParseIsoDatePipe) date: string,
  ): Promise<EditionResponseDto> {
    return this.newsletterService.regenerar(date);
  }

  @Patch('articles/:articleId')
  @ApiOperation({
    summary: 'Corregir una nota a mano',
    description:
      'Cambia headline/standfirst/body sin pasar por el modelo. Los tres son ' +
      'opcionales: mandar sólo uno deja los otros dos como estaban. Marca ' +
      '`isEdited = true`.',
  })
  @ApiResponse({ status: 404, description: 'La nota no existe' })
  @ApiBearerAuth()
  updateArticle(
    @Param('articleId', ParseIntPipe) articleId: number,
    @Body() dto: UpdateArticleDto,
  ): Promise<ArticleDto> {
    return this.newsletterService.updateArticle(articleId, dto);
  }

  @Delete('articles/:articleId')
  @ApiOperation({ summary: 'Borrar una nota' })
  @ApiResponse({ status: 404, description: 'La nota no existe' })
  @ApiBearerAuth()
  @ResponseMessage('Nota borrada')
  deleteArticle(@Param('articleId', ParseIntPipe) articleId: number): Promise<void> {
    return this.newsletterService.deleteArticle(articleId);
  }

  @Get('config')
  @AdminOnly()
  @ApiOperation({
    summary: 'La configuración del diario (solo admin)',
    description:
      'El `styleGuide` es tan interno como el lore de los jugadores: son ' +
      'instrucciones de estilo para el modelo, no algo que el grupo tenga que leer.',
  })
  @ApiResponse({ status: 401, description: 'Falta el token de admin' })
  @ApiBearerAuth()
  findConfig(): Promise<ConfigResponseDto> {
    return this.newsletterService.findConfig();
  }

  @Put('config')
  @ApiOperation({
    summary: 'Actualizar la configuración del diario',
    description:
      'Reemplaza la fila entera. `groupLore` y `styleGuide` ausentes o vacíos ' +
      'la borran.',
  })
  @ApiBearerAuth()
  updateConfig(@Body() dto: UpdateConfigDto): Promise<ConfigResponseDto> {
    return this.newsletterService.updateConfig(dto);
  }
}
