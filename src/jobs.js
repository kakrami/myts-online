import { bulk } from "./db.js";
import { bytes, errInfo, fail, parse, stamp } from "./core.js";
import { Transport } from "./providers/http.js";
import { collectGotSport } from "./providers/gotsport.js";
import { collectTeamSnap } from "./providers/teamsnap.js";
import { collectTrace } from "./providers/trace.js";
const INTERVAL = {
  profile: 7 * 86400000,
  history: 12 * 3600000,
  resolve: 6 * 3600000,
  upcoming: 15 * 60000,
  membership: 3 * 3600000,
  event: 12 * 3600000,
  division: 3600000,
  standings: 3600000,
  catalog: 15 * 60000,
  roster: 6 * 3600000,
  events: 15 * 60000,
  attendance: 15 * 60000,
  game: 6 * 3600000,
  analytics: 12 * 3600000,
  fixture: 15 * 60000,
  organizer: 12 * 3600000,
  categories: 12 * 3600000,
  league: 12 * 3600000,
  tracking: 24 * 3600000,
  radar: 24 * 3600000,
  locations: 6 * 3600000,
  opponents: 6 * 3600000,
};
export function job(provider, kind, scope, args = {}, connection_id = null) {
  return {
    id: `${provider}/${kind}/${scope}`,
    provider,
    kind,
    scope: String(scope),
    connection_id,
    args: JSON.stringify(args),
    cursor: "{}",
    next_at: Date.now(),
    scan_id: crypto.randomUUID(),
    interval_ms: INTERVAL[kind] || 3600000,
  };
}
export function enqueueStatement(db, j, guard = "1", guardArgs = []) {
  return db
    .prepare(
      `INSERT INTO jobs(id,provider,kind,scope,connection_id,args,cursor,next_at,scan_id,interval_ms) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(id) DO UPDATE SET args=excluded.args,connection_id=excluded.connection_id,state=CASE WHEN jobs.state='disabled' THEN 'queued' ELSE jobs.state END,next_at=CASE WHEN jobs.state='disabled' THEN excluded.next_at ELSE jobs.next_at END`,
    )
    .bind(
      j.id,
      j.provider,
      j.kind,
      j.scope,
      j.connection_id,
      j.args,
      j.cursor,
      j.next_at,
      j.scan_id,
      j.interval_ms,
      ...guardArgs,
    );
}
export async function enqueue(db, j) {
  await enqueueStatement(db, j).run();
}
export async function enqueueRoot(db, j, space, kind, entity) {
  const id = space + "/" + kind + "/" + entity;
  await db.batch([
    db
      .prepare(
        "INSERT INTO subscriptions VALUES(?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET active=1",
      )
      .bind(id, space, kind, entity),
    enqueueStatement(db, j),
    db
      .prepare("INSERT OR IGNORE INTO job_interests VALUES(?,?)")
      .bind(id, j.id),
  ]);
}
export async function wake(env) {
  if (!env.SYNC) return;
  const s = env.SYNC.get(env.SYNC.idFromName("scheduler"));
  const r = await s.fetch("https://sync/wake", { method: "POST" });
  if (!r.ok)
    throw fail("Could not wake background processing.", 503, "background_wake");
}
const badFixture = `((fixtures.home_id IS NOT NULL AND fixtures.home_id IS NOT excluded.home_id AND fixtures.conditional=0) OR (fixtures.away_id IS NOT NULL AND fixtures.away_id IS NOT excluded.away_id AND fixtures.conditional=0) OR (fixtures.conditional=0 AND excluded.conditional=1) OR (fixtures.status='FINAL' AND fixtures.home_score IS NOT NULL AND fixtures.away_score IS NOT NULL AND excluded.home_score IS NOT NULL AND excluded.away_score IS NOT NULL AND (fixtures.home_score<>excluded.home_score OR fixtures.away_score<>excluded.away_score)))`;
const conflictIncoming = `((f.home_id IS NOT NULL AND f.home_id IS NOT json_extract(v.value,'$.home_id') AND f.conditional=0) OR (f.away_id IS NOT NULL AND f.away_id IS NOT json_extract(v.value,'$.away_id') AND f.conditional=0) OR (f.conditional=0 AND json_extract(v.value,'$.conditional')=1) OR (f.status='FINAL' AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL AND json_extract(v.value,'$.home_score') IS NOT NULL AND json_extract(v.value,'$.away_score') IS NOT NULL AND (f.home_score<>json_extract(v.value,'$.home_score') OR f.away_score<>json_extract(v.value,'$.away_score'))))`;
function fixtureStatements(db, rows, guard, guardArgs, token) {
  if (!rows.length) return [];
  for (const r of rows) {
    if (bytes(r.payload) > 64000)
      throw fail("A fixture record is too large.", 502, "fixture_size");
  }
  if (bytes(rows) > 1_750_000)
    throw fail("A fixture page is too large.", 502, "page_size");
  const columns = [
      "id",
      "provider",
      "native_id",
      "competition_id",
      "division_id",
      "home_id",
      "away_id",
      "starts_at",
      "local_day",
      "type",
      "status",
      "conditional",
      "home_score",
      "away_score",
      "payload",
      "observed_at",
    ],
    data = JSON.stringify(rows),
    select = columns.map((c) => `json_extract(value,'$.${c}')`).join(",");
  return [
    db
      .prepare(
        `INSERT OR IGNORE INTO conflicts SELECT json_extract(v.value,'$.id')||':'||?,f.id,'source_conflict',json_object('id',f.id,'provider',f.provider,'native_id',f.native_id,'home_id',f.home_id,'away_id',f.away_id,'home_score',f.home_score,'away_score',f.away_score,'status',f.status,'conditional',f.conditional,'revision',f.revision,'payload',json(f.payload)),v.value,?,0 FROM json_each(?) v JOIN fixtures f ON f.id=json_extract(v.value,'$.id') WHERE (${guard}) AND ${conflictIncoming} AND NOT EXISTS(SELECT 1 FROM conflicts c WHERE c.fixture_id=f.id AND c.incoming=v.value)`,
      )
      .bind(token, stamp(), data, ...guardArgs),
    db
      .prepare(
        `INSERT INTO fixtures(${columns.join(",")}) SELECT ${select} FROM json_each(?) WHERE (${guard}) ON CONFLICT(id) DO UPDATE SET ${columns
          .filter(
            (c) =>
              ![
                "id",
                "provider",
                "native_id",
                "home_score",
                "away_score",
                "status",
                "division_id",
                "competition_id",
              ].includes(c),
          )
          .map((c) => `${c}=excluded.${c}`)
          .join(
            ",",
          )},competition_id=COALESCE(excluded.competition_id,fixtures.competition_id),division_id=COALESCE(excluded.division_id,fixtures.division_id),home_score=COALESCE(excluded.home_score,fixtures.home_score),away_score=COALESCE(excluded.away_score,fixtures.away_score),status=CASE WHEN fixtures.status='FINAL' AND excluded.status IN ('SCHEDULED','LIVE') THEN fixtures.status ELSE excluded.status END,revision=fixtures.revision+1 WHERE NOT ${badFixture} AND excluded.observed_at>=fixtures.observed_at`,
      )
      .bind(data, ...guardArgs),
    db
      .prepare(
        `INSERT INTO team_fixtures(team_id,fixture_id,starts_at) SELECT f.home_id,f.id,COALESCE(f.starts_at,f.local_day,'9999-12-31') FROM json_each(?) v JOIN fixtures f ON f.id=json_extract(v.value,'$.id') WHERE f.home_id IS NOT NULL AND (${guard}) ON CONFLICT(team_id,fixture_id) DO UPDATE SET starts_at=excluded.starts_at`,
      )
      .bind(data, ...guardArgs),
    db
      .prepare(
        `INSERT INTO team_fixtures(team_id,fixture_id,starts_at) SELECT f.away_id,f.id,COALESCE(f.starts_at,f.local_day,'9999-12-31') FROM json_each(?) v JOIN fixtures f ON f.id=json_extract(v.value,'$.id') WHERE f.away_id IS NOT NULL AND (${guard}) ON CONFLICT(team_id,fixture_id) DO UPDATE SET starts_at=excluded.starts_at`,
      )
      .bind(data, ...guardArgs),
  ];
}
export async function commit(db, j, result, observations, connection = null) {
  const token = j.lease_token,
    at = Date.now(),
    saved = stamp(),
    leaseGuard = `EXISTS(SELECT 1 FROM jobs WHERE id=? AND lease_token=? AND lease_until>?)${connection ? " AND EXISTS(SELECT 1 FROM connections WHERE id=? AND revision=? AND active=1)" : ""}`,
    leaseArgs = [
      j.id,
      token,
      at,
      ...(connection ? [connection.id, connection.revision] : []),
    ],
    guard = "EXISTS(SELECT 1 FROM commit_fences WHERE job_id=? AND token=?)",
    guardArgs = [j.id, token];
  const statements = [
    db
      .prepare(
        `INSERT INTO commit_fences SELECT ?,?,? WHERE ${leaseGuard} ON CONFLICT(job_id) DO UPDATE SET token=excluded.token,committed_at=excluded.committed_at`,
      )
      .bind(j.id, token, saved, ...leaseArgs),
  ];
  if (result.scan_keys?.length) {
    const keys = JSON.stringify(result.scan_keys),
      seen = await db
        .prepare(
          "SELECT record_id FROM scan_rows WHERE job_id=? AND scan_id=? AND record_id IN (SELECT value FROM json_each(?)) LIMIT 1",
        )
        .bind(j.id, j.scan_id, keys)
        .first();
    if (seen)
      throw fail(
        "Source pagination repeated a saved record. The scan will restart.",
        502,
        "scan_changed",
      );
    statements.push(
      db
        .prepare(
          `INSERT INTO scan_rows SELECT ?,?,value FROM json_each(?) WHERE ${guard}`,
        )
        .bind(j.id, j.scan_id, keys, ...guardArgs),
    );
  }
  // Guard every write with the fence created inside this same transaction.
  for (const [table, rows] of Object.entries(result.records || {})) {
    const s = bulk(db, table, rows, guard, guardArgs);
    if (s) statements.push(s);
  }
  statements.push(
    ...fixtureStatements(db, result.fixtures || [], guard, guardArgs, token),
  );
  const children = [
    ...new Map((result.jobs || []).map((x) => [x.id, x])).values(),
  ];
  if (children.length) {
    const data = JSON.stringify(children);
    if (bytes(data) > 1500000)
      throw fail("Too many source tasks in one page.", 502, "task_page_size");
    statements.push(
      db
        .prepare(
          `INSERT INTO jobs(id,provider,kind,scope,connection_id,args,cursor,next_at,scan_id,interval_ms) SELECT json_extract(value,'$.id'),json_extract(value,'$.provider'),json_extract(value,'$.kind'),json_extract(value,'$.scope'),json_extract(value,'$.connection_id'),json_extract(value,'$.args'),json_extract(value,'$.cursor'),json_extract(value,'$.next_at'),json_extract(value,'$.scan_id'),json_extract(value,'$.interval_ms') FROM json_each(?) WHERE ${guard} ON CONFLICT(id) DO UPDATE SET args=excluded.args,connection_id=excluded.connection_id,state=CASE WHEN jobs.state='disabled' THEN 'queued' ELSE jobs.state END,next_at=CASE WHEN jobs.state='disabled' THEN excluded.next_at ELSE jobs.next_at END`,
        )
        .bind(data, ...guardArgs),
    );
  }

  if (children.length)
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO job_interests SELECT i.subscription_id,json_extract(v.value,'$.id') FROM job_interests i JOIN subscriptions s ON s.id=i.subscription_id JOIN json_each(?) v WHERE i.job_id=? AND s.active=1 AND ${guard}`,
        )
        .bind(JSON.stringify(children), j.id, ...guardArgs),
    );
  for (const mutation of result.mutations || [])
    statements.push(
      db
        .prepare(mutation.sql.replaceAll("$GUARD", guard))
        .bind(...mutation.args, ...guardArgs),
    );
  for (const o of observations)
    statements.push(
      db
        .prepare(
          `INSERT INTO observations SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`,
        )
        .bind(
          o.id,
          j.id,
          j.scan_id,
          o.endpoint,
          o.params,
          o.at,
          o.status,
          o.rows_count,
          o.bytes,
          o.hash,
          o.error,
          ...guardArgs,
        ),
    );
  const done = !!result.complete,
    cursor = JSON.stringify(result.cursor || {});
  if (bytes(cursor) > 16000)
    throw fail("Job cursor exceeds its bounded contract.", 502, "cursor_size");
  const rows =
    Object.values(result.records || {}).reduce((n, r) => n + r.length, 0) +
    (result.fixtures?.length || 0);
  const coverage = result.coverage || (done ? "complete" : "partial");
  statements.push(
    db
      .prepare(
        `UPDATE jobs SET state=?,cursor=?,next_at=?,lease_token=NULL,lease_until=0,failures=0,last_error=NULL,last_retrieved=?,last_saved=?,last_complete=CASE WHEN ? THEN ? ELSE last_complete END,pages=pages+1,rows_saved=rows_saved+?,coverage=? WHERE id=? AND lease_token=? AND ${guard}`,
      )
      .bind(
        done ? "ready" : "queued",
        cursor,
        at + (done ? j.interval_ms : 1000),
        observations.at(-1)?.at || j.last_retrieved,
        saved,
        done ? 1 : 0,
        saved,
        rows,
        coverage,
        j.id,
        token,
        ...guardArgs,
      ),
  );
  const results = await db.batch(statements);
  if (results.at(-1).meta.changes !== 1)
    throw fail(
      "The job lease or connection changed before save.",
      409,
      "lease_lost",
    );
  return {
    state: done ? "ready" : "partial",
    rows,
    pages: j.pages + 1,
    coverage,
  };
}
export async function runOne(db, env) {
  const at = Date.now(),
    candidate = await db
      .prepare(
        `SELECT * FROM jobs WHERE state<>'disabled' AND ((provider='teamsnap' AND (kind='catalog' OR EXISTS(SELECT 1 FROM space_teams st WHERE st.team_id=jobs.scope AND st.role='primary'))) OR EXISTS(SELECT 1 FROM job_interests i JOIN subscriptions s ON s.id=i.subscription_id WHERE i.job_id=jobs.id AND s.active=1)) AND next_at<=? AND lease_until<=? ORDER BY next_at,id LIMIT 1`,
      )
      .bind(at, at)
      .first();
  if (!candidate) return { state: "idle" };
  let connection = null;
  if (candidate.connection_id) {
    connection = await db
      .prepare("SELECT * FROM connections WHERE id=? AND active=1")
      .bind(candidate.connection_id)
      .first();
    if (!connection) {
      await db
        .prepare(
          "UPDATE jobs SET state='disabled',lease_token=NULL,lease_until=0 WHERE id=?",
        )
        .bind(candidate.id)
        .run();
      return { state: "disabled", job: candidate.id };
    }
  }
  const token = crypto.randomUUID(),
    j = await db
      .prepare(
        `UPDATE jobs SET lease_token=?,lease_until=?,state='running',attempts=attempts+1,last_attempt=? WHERE id=? AND lease_until<=? AND next_at<=? RETURNING *`,
      )
      .bind(token, at + 45000, stamp(), candidate.id, at, at)
      .first();
  if (!j) return { state: "contended" };
  if (
    j.state === "running" &&
    j.coverage !== "partial" &&
    parse(j.cursor).finished
  ) {
    await db
      .prepare(
        "UPDATE jobs SET cursor='{}',scan_id=?,pages=0,rows_saved=0 WHERE id=? AND lease_token=?",
      )
      .bind(crypto.randomUUID(), j.id, token)
      .run();
    j.cursor = "{}";
    j.scan_id = (
      await db.prepare("SELECT scan_id FROM jobs WHERE id=?").bind(j.id).first()
    ).scan_id;
    j.pages = 0;
    j.rows_saved = 0;
  }
  const transport = new Transport(env, j);
  try {
    const args = parse(j.args),
      cursor = parse(j.cursor),
      collector = {
        gotsport: collectGotSport,
        live: collectGotSport,
        teamsnap: collectTeamSnap,
        trace: collectTrace,
      }[j.provider];
    if (!collector) throw fail("Unknown job provider.", 500, "job_provider");
    const result = await collector({
      db,
      env,
      j,
      args,
      cursor,
      transport,
      connection,
    });
    return {
      job: j.id,
      ...(await commit(db, j, result, transport.observations, connection)),
    };
  } catch (e) {
    const info = errInfo(e),
      restart = e.code === "scan_changed",
      continuing = ["request_limit", "invocation_limit"].includes(e.code),
      delay = continuing
        ? 15000
        : Math.min(
            6 * 3600000,
            Math.max(e.retry_ms || 0, 60000 * 2 ** Math.min(j.failures, 7)),
          );
    const saved = await db
      .prepare(
        `UPDATE jobs SET cursor=CASE WHEN ? THEN '{}' ELSE cursor END,scan_id=CASE WHEN ? THEN ? ELSE scan_id END,coverage=CASE WHEN ? THEN 'partial' ELSE coverage END,state=?,next_at=?,lease_token=NULL,lease_until=0,failures=failures+?,last_error=? WHERE id=? AND lease_token=?`,
      )
      .bind(
        restart ? 1 : 0,
        restart ? 1 : 0,
        crypto.randomUUID(),
        restart ? 1 : 0,
        continuing ? "queued" : "error",
        Date.now() + delay,
        continuing ? 0 : 1,
        JSON.stringify(info),
        j.id,
        token,
      )
      .run();
    for (const o of transport.observations.slice(
      0,
      Math.max(0, db.limit - db.used - 2),
    ))
      await db
        .prepare(
          "INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          o.id,
          j.id,
          j.scan_id,
          o.endpoint,
          o.params,
          o.at,
          o.status,
          o.rows_count,
          o.bytes,
          o.hash,
          o.error,
        )
        .run();
    return {
      job: j.id,
      state: saved.meta.changes
        ? continuing
          ? "deferred"
          : "error"
        : "lease_lost",
      error: info,
    };
  }
}
export async function retry(db, id) {
  await db
    .prepare(
      "UPDATE jobs SET next_at=?,state='queued' WHERE id=? AND lease_until<=?",
    )
    .bind(Date.now(), id, Date.now())
    .run();
}
