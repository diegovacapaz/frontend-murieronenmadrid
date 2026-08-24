import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
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
  ],
  exports: [NewsletterService],
})
export class NewsletterModule {}
