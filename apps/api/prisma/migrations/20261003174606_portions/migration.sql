-- CreateTable
CREATE TABLE "PortionSize" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "PortionSize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionGroupSize" (
    "groupId" INTEGER NOT NULL,
    "sizeId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "OptionGroupSize_pkey" PRIMARY KEY ("groupId","sizeId")
);

-- CreateTable
CREATE TABLE "OptionSize" (
    "optionId" INTEGER NOT NULL,
    "sizeId" INTEGER NOT NULL,
    "extraCharge" INTEGER NOT NULL,

    CONSTRAINT "OptionSize_pkey" PRIMARY KEY ("optionId","sizeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortionSize_name_key" ON "PortionSize"("name");

-- AddForeignKey
ALTER TABLE "OptionGroupSize" ADD CONSTRAINT "OptionGroupSize_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "OptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionGroupSize" ADD CONSTRAINT "OptionGroupSize_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "PortionSize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionSize" ADD CONSTRAINT "OptionSize_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "Option"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionSize" ADD CONSTRAINT "OptionSize_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "PortionSize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
