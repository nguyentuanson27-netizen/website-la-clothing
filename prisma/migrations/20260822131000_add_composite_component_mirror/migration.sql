-- CreateTable
CREATE TABLE "CompositeComponentMirror" (
    "parentVariantId" TEXT NOT NULL,
    "componentVariantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompositeComponentMirror_pkey" PRIMARY KEY ("parentVariantId", "componentVariantId"),
    CONSTRAINT "CompositeComponentMirror_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "CompositeComponentMirror_not_self" CHECK ("parentVariantId" <> "componentVariantId")
);

-- CreateIndex
CREATE INDEX "CompositeComponentMirror_componentVariantId_idx" ON "CompositeComponentMirror"("componentVariantId");

-- AddForeignKey
ALTER TABLE "CompositeComponentMirror" ADD CONSTRAINT "CompositeComponentMirror_parentVariantId_fkey" FOREIGN KEY ("parentVariantId") REFERENCES "VariantMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositeComponentMirror" ADD CONSTRAINT "CompositeComponentMirror_componentVariantId_fkey" FOREIGN KEY ("componentVariantId") REFERENCES "VariantMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;
