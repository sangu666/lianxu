-- 数据库约束作为第二道检查；接口层仍须使用现有业务校验器检查完整 JSON。
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_revision_positive" CHECK ("revision" >= 1);
ALTER TABLE "PlanVersion" ADD CONSTRAINT "PlanVersion_positive" CHECK ("version" >= 1);
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_revision_positive" CHECK ("revision" >= 1);
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_time_order" CHECK ("startedAt" IS NULL OR "completedAt" IS NULL OR "completedAt" >= "startedAt");
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_active_unfinished" CHECK ("status" <> 'active' OR "completedAt" IS NULL);
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_origin_valid" CHECK ("origin" IN ('manual', 'legacy'));
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_unit_known" CHECK ("unit" IN ('reps', 'seconds'));
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_position_nonnegative" CHECK ("position" >= 0);
ALTER TABLE "WorkoutSet" ADD CONSTRAINT "WorkoutSet_bounds" CHECK ("loadKg" BETWEEN 0 AND 400 AND "value" BETWEEN 1 AND 3600 AND "position" >= 0 AND ("rir" IS NULL OR "rir" BETWEEN 0 AND 3));
ALTER TABLE "WeightEntry" ADD CONSTRAINT "WeightEntry_positive" CHECK ("kg" > 0);
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_origin_valid" CHECK ("origin" IN ('builtin', 'community'));

-- 部分唯一索引使同一账户最多拥有一项进行中的训练。
CREATE UNIQUE INDEX "Workout_one_active_per_user" ON "Workout" ("userId") WHERE "status" = 'active';

-- 防止代码误用 UPDATE 改写已被训练引用的计划；修改必须插入新版本。
CREATE FUNCTION reject_plan_version_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PlanVersion is immutable; insert a new version';
END;
$$;
CREATE TRIGGER "PlanVersion_immutable" BEFORE UPDATE ON "PlanVersion"
FOR EACH ROW EXECUTE FUNCTION reject_plan_version_update();

-- CHECK 不能跨表读取单位，因此用触发器检查次数上限；秒数上限由 CHECK 限定。
CREATE FUNCTION check_set_unit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action_unit "ExerciseUnit";
BEGIN
  SELECT "unit" INTO action_unit FROM "WorkoutExercise"
  WHERE "userId" = NEW."userId" AND "workoutId" = NEW."workoutId" AND "id" = NEW."workoutExerciseId";
  IF action_unit = 'reps' AND NEW."value" > 100 THEN
    RAISE EXCEPTION 'Repetition count exceeds 100';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "WorkoutSet_unit_bounds" BEFORE INSERT OR UPDATE ON "WorkoutSet"
FOR EACH ROW EXECUTE FUNCTION check_set_unit();

-- 已有训练动作的单位不可变，避免将已记录秒数重新解释为次数。
CREATE FUNCTION reject_workout_unit_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."unit" <> OLD."unit" OR NEW."exerciseId" <> OLD."exerciseId" THEN
    RAISE EXCEPTION 'Workout exercise identity and unit are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "WorkoutExercise_unit_immutable" BEFORE UPDATE ON "WorkoutExercise"
FOR EACH ROW EXECUTE FUNCTION reject_workout_unit_update();
