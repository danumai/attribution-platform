import { Module } from '@nestjs/common';
import { IssueController } from './issue.controller';
import { PartnerController } from './partner.controller';
import { PartnerRepository } from './partner.repository';
import { PartnerService } from './partner.service';

/**
 * The two API-key surfaces, which are opposites: a publisher calls `/v1/attribution/*` and is
 * paid, a promoter calls `/v1/issue` and pays. They share `orgFromKey`, which is why they share a
 * module; no guard is imported, because the key itself is the identity and each route resolves it.
 */
@Module({
  controllers: [PartnerController, IssueController],
  providers: [PartnerService, PartnerRepository],
})
export class PartnerModule {}
