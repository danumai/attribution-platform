-- DropForeignKey
ALTER TABLE "redemptions" DROP CONSTRAINT "redemptions_install_id_fkey";

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_install_id_fkey" FOREIGN KEY ("install_id") REFERENCES "installs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
