-- A category with compliance rules can no longer be deleted (the rules used to cascade away).
ALTER TABLE "compliance_rules" DROP CONSTRAINT "compliance_rules_categoryId_fkey";
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
