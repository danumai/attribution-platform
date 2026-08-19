-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_campaign_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_org_id_fkey";

-- DropForeignKey
ALTER TABLE "redemptions" DROP CONSTRAINT "redemptions_qr_code_id_fkey";

-- DropForeignKey
ALTER TABLE "withdrawals" DROP CONSTRAINT "withdrawals_publisher_org_id_fkey";

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_qr_code_id_fkey" FOREIGN KEY ("qr_code_id") REFERENCES "qr_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_publisher_org_id_fkey" FOREIGN KEY ("publisher_org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
