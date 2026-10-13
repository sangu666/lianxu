-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ExerciseUnit" AS ENUM ('reps', 'seconds', 'unspecified');

-- CreateEnum
CREATE TYPE "WorkoutStatus" AS ENUM ('active', 'completed');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "userId" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" VARCHAR(100) NOT NULL,
    "nameZh" VARCHAR(200) NOT NULL,
    "nameEn" VARCHAR(200) NOT NULL,
    "bodyPart" VARCHAR(80) NOT NULL,
    "equipment" VARCHAR(80) NOT NULL,
    "target" VARCHAR(80) NOT NULL,
    "secondaryMuscles" TEXT[],
    "stepsZh" TEXT[],
    "stepsEn" TEXT[],
    "unit" "ExerciseUnit" NOT NULL,
    "origin" VARCHAR(40) NOT NULL,
    "sourceId" VARCHAR(100) NOT NULL,
    "sourceCommit" VARCHAR(40),
    "mistake" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanVersion" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workout" (
    "userId" UUID NOT NULL,
    "id" VARCHAR(160) NOT NULL,
    "planVersion" INTEGER NOT NULL,
    "planName" VARCHAR(200) NOT NULL,
    "date" DATE NOT NULL,
    "status" "WorkoutStatus" NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "origin" VARCHAR(40) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Workout_pkey" PRIMARY KEY ("userId","id")
);

-- CreateTable
CREATE TABLE "WorkoutExercise" (
    "userId" UUID NOT NULL,
    "workoutId" VARCHAR(160) NOT NULL,
    "id" VARCHAR(160) NOT NULL,
    "exerciseId" VARCHAR(200) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "unit" "ExerciseUnit" NOT NULL,
    "position" INTEGER NOT NULL,
    "prescription" JSONB,

    CONSTRAINT "WorkoutExercise_pkey" PRIMARY KEY ("userId","workoutId","id")
);

-- CreateTable
CREATE TABLE "WorkoutSet" (
    "userId" UUID NOT NULL,
    "workoutId" VARCHAR(160) NOT NULL,
    "workoutExerciseId" VARCHAR(160) NOT NULL,
    "id" VARCHAR(160) NOT NULL,
    "position" INTEGER NOT NULL,
    "loadKg" DECIMAL(8,3) NOT NULL,
    "value" INTEGER NOT NULL,
    "rir" INTEGER,
    "pain" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WorkoutSet_pkey" PRIMARY KEY ("userId","workoutId","workoutExerciseId","id")
);

-- CreateTable
CREATE TABLE "WeightEntry" (
    "userId" UUID NOT NULL,
    "id" VARCHAR(160) NOT NULL,
    "date" DATE NOT NULL,
    "kg" DECIMAL(6,3) NOT NULL,

    CONSTRAINT "WeightEntry_pkey" PRIMARY KEY ("userId","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Exercise_bodyPart_equipment_idx" ON "Exercise"("bodyPart", "equipment");

-- CreateIndex
CREATE INDEX "Exercise_origin_idx" ON "Exercise"("origin");

-- CreateIndex
CREATE UNIQUE INDEX "PlanVersion_userId_version_key" ON "PlanVersion"("userId", "version");

-- CreateIndex
CREATE INDEX "Workout_userId_date_idx" ON "Workout"("userId", "date");

-- CreateIndex
CREATE INDEX "WorkoutExercise_userId_exerciseId_unit_idx" ON "WorkoutExercise"("userId", "exerciseId", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutExercise_userId_workoutId_position_key" ON "WorkoutExercise"("userId", "workoutId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSet_userId_workoutId_workoutExerciseId_position_key" ON "WorkoutSet"("userId", "workoutId", "workoutExerciseId", "position");

-- CreateIndex
CREATE INDEX "WeightEntry_userId_date_idx" ON "WeightEntry"("userId", "date");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanVersion" ADD CONSTRAINT "PlanVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_userId_planVersion_fkey" FOREIGN KEY ("userId", "planVersion") REFERENCES "PlanVersion"("userId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_userId_workoutId_fkey" FOREIGN KEY ("userId", "workoutId") REFERENCES "Workout"("userId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSet" ADD CONSTRAINT "WorkoutSet_userId_workoutId_workoutExerciseId_fkey" FOREIGN KEY ("userId", "workoutId", "workoutExerciseId") REFERENCES "WorkoutExercise"("userId", "workoutId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightEntry" ADD CONSTRAINT "WeightEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
