import { Module } from '@nestjs/common';
import { IssueController } from './issue.controller';
import { PartnerController } from './partner.controller';
import { PartnerRepository } from './partner.repository';
import { PartnerService } from './partner.service';

/**
 * Both API-key surfaces (publisher `/v1/attribution/*`, promoter `/v1/issue`); they share a module
 * because they share `orgFromKey`. No guard: the key is the identity, resolved per route.
 */
@Module({
  controllers: [PartnerController, IssueController],
  providers: [PartnerService, PartnerRepository],
})
export class PartnerModule {}
