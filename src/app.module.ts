import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminGuard } from './auth/guards/admin.guard';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { GlobalsModule } from './globals/globals.module';
import { HealthController } from './health.controller';
import { AchievementsModule } from './modules/achievements/achievements.module';
import { MatchesModule } from './modules/matches/matches.module';
import { MundialitoModule } from './modules/mundialito/mundialito.module';
import { NewsletterModule } from './modules/newsletter/newsletter.module';
import { PenaltiesModule } from './modules/penalties/penalties.module';
import { PlayersModule } from './modules/players/players.module';
import { ScoreboardModule } from './modules/scoreboard/scoreboard.module';
import { StatsModule } from './modules/stats/stats.module';
import { TeamsModule } from './modules/teams/teams.module';
import { TournamentsModule } from './modules/tournaments/tournaments.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    // Infraestructura. Globals va primero: el pool de la base lee su
    // configuracion de ahi.
    GlobalsModule,
    DatabaseModule,
    RealtimeModule,
    AuthModule,
    // Habilita el @Cron de NewsletterCron. Va en infraestructura y no en
    // Dominio: no es un modulo de negocio, es lo que hace que los decoradores
    // de cron de cualquier modulo se registren.
    ScheduleModule.forRoot(),

    // Dominio.
    PlayersModule,
    TournamentsModule,
    MatchesModule,
    PenaltiesModule,
    TeamsModule,
    ScoreboardModule,
    StatsModule,
    MundialitoModule,
    AchievementsModule,
    NewsletterModule,
  ],
  controllers: [HealthController],
  providers: [
    // Guard global: leer es libre, escribir exige el token de admin. Ver
    // AdminGuard para el porque de decidirlo por metodo HTTP.
    { provide: APP_GUARD, useClass: AdminGuard },
  ],
})
export class AppModule {}
