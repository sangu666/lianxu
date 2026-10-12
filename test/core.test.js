import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultState,
  createPlan,
  createReview,
  advanceVersion,
  normalizeState,
} from '../public/core.js';

test('all home/gym and beginner/experienced combinations produce 3/4 day plans', () => {
  for (const equipment of ['home', 'gym'])
    for (const experience of ['beginner', 'experienced'])
      for (const days of [3, 4]) {
        const profile = { ...createDefaultState().profile, equipment, experience, days };
        const plan = createPlan(profile);
        assert.equal(plan.length, days);
        assert.equal(plan[0].sets, experience === 'beginner' ? 2 : 3);
        if (equipment === 'home')
          assert.ok(
            plan
              .flatMap((day) => day.exercises)
              .every((name) => !/器械|高位下拉|腿举|腿弯举/.test(name)),
          );
      }
});
test('full-body template covers squat, push, pull and hinge without duplicates', () => {
  const day = createPlan(createDefaultState().profile)[0];
  assert.deepEqual(day.exercises, [
    '高脚杯深蹲',
    '哑铃地板卧推',
    '单臂哑铃划船',
    '哑铃罗马尼亚硬拉',
  ]);
  assert.equal(new Set(day.exercises).size, 4);
});
test('unsupported profile and nonfinite values cannot generate a plan', () => {
  for (const patch of [{ age: 17 }, { weight: NaN }, { days: 7 }, { equipment: 'unknown' }])
    assert.throws(() => createPlan({ ...createDefaultState().profile, ...patch }));
});
test('pain takes priority over fatigue and does not create a deload proposal', () => {
  const state = createDefaultState();
  state.logs.push({ pain: true });
  assert.equal(createReview(state, 'tired').kind, 'blocked');
});
test('prototype fatigue proposal reduces one set for both experience levels', () => {
  for (const experience of ['beginner', 'experienced']) {
    const state = createDefaultState();
    state.profile.experience = experience;
    const proposal = createReview(state, 'tired');
    assert.equal(proposal.kind, 'deload');
    assert.equal(proposal.before - proposal.after, 1);
    assert.equal(createReview({ ...state, adjusted: true }, 'tired').kind, 'maintain');
  }
});
test('version change preserves history and training records without mutating old state', () => {
  const state = createDefaultState();
  state.logs.push({ version: 1 });
  const next = advanceVersion(state, state.profile, true, '减量演示');
  assert.equal(state.version, 1);
  assert.equal(state.history.length, 1);
  assert.equal(next.version, 2);
  assert.equal(next.logs[0].version, 1);
  assert.equal(next.history[0].adjusted, false);
  assert.equal(next.history[1].adjusted, true);
});
test('corrupt persisted data falls back to clean sample state', () => {
  assert.deepEqual(normalizeState({ profile: 'broken' }), createDefaultState());
  const state = createDefaultState();
  state.weights = [{ date: 'bad', value: 'oops' }];
  assert.deepEqual(normalizeState(state), createDefaultState());
});
test('valid persisted records survive normalization', () => {
  const state = createDefaultState();
  state.weights.push({ date: '2026-10-12', value: 70 });
  state.logs.push({
    exercise: '高脚杯深蹲',
    load: 10,
    reps: 10,
    rir: 2,
    pain: false,
    date: '2026-10-12',
    version: 1,
  });
  assert.deepEqual(normalizeState(state), state);
});
