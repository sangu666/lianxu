import { createOutbox, isReliablePath } from './sync-outbox.js';
import { initialState, validateState } from './storage.js';

/** 同源账户客户端；会话由 HttpOnly Cookie 保管，CSRF 只留在当前页面内存。 */
export function createAccountApi(fetcher = fetch, outboxOptions = {}) {
  let session = null; // 当前服务端确认的用户及 CSRF；不写浏览器存储。
  let syncNotify = () => {};
  const outbox = createOutbox({ ...outboxOptions, notify: () => syncNotify() });
  async function rawRequest(path, method = 'GET', body, key) {
    let response;
    const controller = new AbortController(); // 20 秒后停止等待；写入可能已提交，待同步请求仍沿用原编号。
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      response = await fetcher(`/api/v1${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(key ? { 'Idempotency-Key': key } : {}),
          ...(session ? { 'X-Account-Id': session.user.id } : {}),
          ...(method !== 'GET' && session ? { 'X-CSRF-Token': session.csrfToken } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      clearTimeout(timeout);
      throw new Error('连接失败，修改尚未确认保存。请保持输入并检查服务，再刷新核对。');
    }
    let data;
    try {
      data = await response.json();
      clearTimeout(timeout);
    } catch {
      clearTimeout(timeout);
      const error = new Error('账户服务未启动，请使用 http://127.0.0.1:3100。');
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(data.error?.message ?? '请求失败。');
      error.status = response.status;
      error.code = data.error?.code;
      throw error;
    }
    return data;
  }
  async function request(path, method = 'GET', body) {
    if (session && isReliablePath(path, method))
      return outbox.execute(session.user.id, path, method, body, rawRequest);
    if (
      session &&
      path.startsWith('/me/imports') &&
      method !== 'DELETE' &&
      outbox.read(session.user.id)
    )
      throw new Error('请先处理账户待同步修改，再迁移备份。');
    return rawRequest(path, method, body);
  }
  /** 分页读完，不把默认第一页误认为全部训练历史。 */
  async function all(path) {
    const rows = [];
    for (let page = 1; ; page++) {
      const data = await request(`${path}?page=${page}&pageSize=100`);
      rows.push(...data.items);
      if (rows.length >= data.pagination.total) return rows;
    }
  }
  async function restore() {
    try {
      session = await request('/me');
      return session;
    } catch (error) {
      if ([401, 404].includes(error.status)) {
        session = null;
        return null;
      }
      throw error;
    }
  }
  async function authenticate(kind, email, password) {
    session = await request(`/auth/${kind}`, 'POST', { email, password });
    return session;
  }
  async function load() {
    const [profile, versions, summaries, weights] = await Promise.all([
      request('/me/profile'),
      all('/me/plans'),
      all('/me/workout-records'),
      all('/me/weights'),
    ]);
    const workouts = summaries.map((item) => ({
      ...item,
      exercises: item.exercises.map((action) => ({
        ...action,
        ...(action.prescription === null ? { prescription: undefined } : {}),
        sets: action.sets.map((set) => ({
          id: set.id,
          load: Number(set.loadKg),
          value: set.value,
          rir: set.rir,
          pain: set.pain,
        })),
      })),
    }));
    const state = initialState();
    state.history = versions.reverse().map((item) => item.snapshot);
    const latest = state.history.at(-1);
    if (latest)
      Object.assign(state, {
        profile: profile.profile,
        version: latest.version,
        adjusted: latest.adjusted,
        ...(latest.editablePlan ? { editablePlan: latest.editablePlan } : {}),
        ...(latest.planOverrides ? { planOverrides: latest.planOverrides } : {}),
      });
    state.workouts = workouts;
    state.weights = weights
      .map((item) => ({ id: item.id, date: item.date, value: Number(item.kg) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    validateState(state);
    return { state, profileRevision: profile.revision, weights };
  }
  /** 一次用户动作对应一种事务；批量旧备份迁移另有预览流程，不能隐式上传。 */
  async function save(before, next, metadata, { profile = false } = {}) {
    validateState(next);
    if (profile) {
      const data = await request('/me/profile', 'PUT', {
        profile: next.profile,
        expectedRevision: metadata.profileRevision,
        expectedVersion: metadata.profileRevision ? before.version : 0,
      });
      const snapshot = data.snapshot;
      const state = {
        ...next,
        profile: data.profile,
        version: data.planVersion,
        adjusted: false,
        history: [...before.history, snapshot],
      };
      delete state.editablePlan;
      delete state.planOverrides;
      return { ...metadata, state, profileRevision: data.revision };
    }
    if (!metadata.profileRevision)
      throw new Error('请先在“身体与资料”保存账户资料，示例计划尚未写入账户。');
    if (next.version !== before.version) {
      const { adjusted, editablePlan, planOverrides } = next;
      const result = await request('/me/plans', 'POST', {
        expectedVersion: before.version,
        expectedRevision: metadata.profileRevision,
        plan: {
          adjusted,
          reason: next.history.at(-1).reason,
          ...(editablePlan ? { editablePlan } : {}),
          ...(planOverrides ? { planOverrides } : {}),
        },
      });
      if (result.version !== next.version) throw new Error('计划版本已变化，请刷新核对。');
      return { ...metadata, state: { ...next, history: [...before.history, result.snapshot] } };
    }
    const changed = next.workouts.filter(
      (item) =>
        JSON.stringify(item) !== JSON.stringify(before.workouts.find((old) => old.id === item.id)),
    );
    const removed = before.workouts.filter(
      (item) => !next.workouts.some((row) => row.id === item.id),
    );
    const weightChanges = next.weights.filter(
      (item) =>
        JSON.stringify(item) !==
        JSON.stringify(before.weights.find((old) => old.date === item.date)),
    );
    if (changed.length + removed.length + weightChanges.length !== 1)
      throw new Error('账户模式一次保存一项修改；旧备份请使用“迁移旧备份到账户”入口。');
    const state = structuredClone(next);
    if (changed.length) {
      const workout = changed[0];
      const original = before.workouts.find((item) => item.id === workout.id);
      const result = await request(`/me/workouts/${encodeURIComponent(workout.id)}`, 'PUT', {
        expectedRevision: original?.revision ?? 0,
        workout,
      });
      state.workouts.find((item) => item.id === workout.id).revision = result.revision;
    } else if (removed.length) {
      await request(`/me/workouts/${encodeURIComponent(removed[0].id)}`, 'DELETE', {
        expectedRevision: removed[0].revision,
      });
    } else {
      const item = weightChanges[0],
        old = metadata.weights.find((row) => row.date === item.date);
      const result = await request(`/me/weights/${item.date}`, 'PUT', {
        value: item.value,
        expected: old ? { id: old.id, kg: old.kg } : null,
      });
      // 账户导出保留数据库稳定编号；同日更正不生成另一条测量身份。
      Object.assign(
        state.weights.find((row) => row.date === item.date),
        { id: result.item.id },
      );
      metadata = {
        ...metadata,
        weights: [...metadata.weights.filter((row) => row.date !== item.date), result.item],
      };
    }
    return { ...metadata, state };
  }
  async function logout() {
    await request('/auth/logout', 'POST', {});
    session = null;
  }
  return {
    request,
    restore,
    authenticate,
    load,
    save,
    logout,
    getSession: () => session,
    getPending: () => (session ? outbox.read(session.user.id) : null),
    getPendingRaw: () => (session ? outbox.raw(session.user.id) : null),
    retryPending: () => {
      if (!session) throw new Error('请先登录原账户。');
      return outbox.retry(session.user.id, rawRequest);
    },
    discardPending: () => {
      if (!session) throw new Error('请先登录原账户。');
      return outbox.discard(session.user.id);
    },
    onSyncChange: (callback) => {
      syncNotify = callback;
    },
  };
}
