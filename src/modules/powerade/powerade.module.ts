import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { NewsletterModule } from '../newsletter/newsletter.module';
import { POWERADE_REPOSITORY } from './powerade.constants';
import { PoweradeController } from './powerade.controller';
import { PoweradeMcpService } from './powerade-mcp.service';
import { PoweradeRepository } from './powerade.repository';
import { PoweradeService } from './powerade.service';

@Module({
  // NewsletterModule exporta el DossierBuilder y el NewsletterService (la config
  // del diario): el Powerade los reusa en vez de duplicarlos.
  imports: [DatabaseModule, NewsletterModule],
  controllers: [PoweradeController],
  providers: [
    { provide: POWERADE_REPOSITORY, useClass: PoweradeRepository },
    PoweradeService,
    // El servicio del MCP: arma el borrador y publica lo que escribe un cliente
    // MCP. Se exporta porque `montarMcp` lo pide con `app.get` desde main.ts.
    PoweradeMcpService,
  ],
  exports: [PoweradeService, PoweradeMcpService],
})
export class PoweradeModule {}
