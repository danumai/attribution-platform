import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../prisma/generated/client';
import { pool } from './database';

export type { Prisma } from '../../prisma/generated/client';
export { pool } from './database';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg(pool) });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

export const prismaService = new PrismaService();

export const prisma = prismaService;

export type Tx = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$extends' | '$on' | '$use' | 'onModuleDestroy'
>;

@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: prismaService }],
  exports: [PrismaService],
})
export class PrismaModule {}
