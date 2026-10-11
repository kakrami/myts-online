import { constantEqual, digest } from '../security/crypto.js';

export class InstallationError extends Error {
  constructor(code,message,status=409) { super(message);this.code=code;this.status=status; }
}
const fail=(code,message,status)=>{throw new InstallationError(code,message,status);};
const META=`CREATE TABLE IF NOT EXISTS setup_state(id INTEGER PRIMARY KEY CHECK(id=1),schema_fingerprint TEXT NOT NULL,next_index INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL CHECK(state IN('initializing','ready')),started_at TEXT NOT NULL,completed_at TEXT)`;
const query="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'";
const readyRow='SELECT schema_fingerprint,next_index,state FROM setup_state WHERE id=1';
const encode=new TextEncoder();

/** Only CREATE statements for the single fresh schema are accepted. No upgrades. */
export function installationSchema(groups) {
  const statements=groups.flat();
  if(!statements.length||statements.some(sql=>typeof sql!=='string'||!/^CREATE\s+(TABLE|VIEW|TRIGGER|(?:UNIQUE\s+)?INDEX)\s/i.test(sql))) throw new Error('The fresh schema contains an invalid statement.');
  return statements.map(sql=>sql.replace(/^CREATE\s+(TABLE|VIEW|TRIGGER|(?:UNIQUE\s+)?INDEX)\s+(?!IF\s+NOT\s+EXISTS)/i,'CREATE $1 IF NOT EXISTS '));
}

export class FreshInstallation {
  constructor(db,{schema,bootstrapPassword,now=Date.now,batchSize=30,seed=[]}={}) {
    if(!Number.isInteger(batchSize)||batchSize<1||batchSize>30)throw new Error('Invalid installation batch size.');
    if(!Array.isArray(seed)||seed.length>10||seed.some(s=>!/^INSERT INTO\s+\w+/i.test(s.sql)||!Array.isArray(s.params)))throw new Error('Invalid fresh initialization seed.');
    this.db=db;this.schema=installationSchema([schema]);this.seed=seed;this.bootstrapPassword=bootstrapPassword;this.now=now;this.batchSize=batchSize;
    this.fingerprint=digest(JSON.stringify({schema:this.schema,seed}));
    this.tables=new Set(this.schema.filter(sql=>/^CREATE TABLE/i.test(sql)).map(sql=>sql.match(/^CREATE TABLE IF NOT EXISTS\s+(\w+)/i)[1]));
  }
  async inspect() {
    const names=(await this.db.prepare(query).all()).results.map(r=>r.name);
    if(!names.includes('setup_state')) {
      if(names.some(name=>name!=='d1_migrations')) fail('fresh_database_required','This build requires a new, empty database.');
      return {state:'empty',progress:0};
    }
    const domainSeed=this.seed.some(s=>/^INSERT INTO domain_installation\b/i.test(s.sql));
    const row=await this.db.prepare(domainSeed&&names.includes('domain_installation')?readyRow.replace(' FROM setup_state',', (SELECT COUNT(*) FROM domain_installation WHERE id=1) AS domain_seed_count FROM setup_state'):readyRow).first();
    if(!row||row.schema_fingerprint!==await this.fingerprint||names.some(name=>name!=='setup_state'&&name!=='d1_migrations'&&!this.tables.has(name)))
      fail('fresh_database_required','This database belongs to a different build. Use a new, empty database.');
    if(row.state==='ready'&&([...this.tables].some(name=>!names.includes(name))||domainSeed&&row.domain_seed_count!==1))
      fail('installation_incomplete','This installation is missing required records. Use a new, empty database.');
    return {...row,progress:Math.min(100,Math.floor(row.next_index/this.schema.length*100))};
  }
  async verifyBootstrap(password) {
    if(typeof this.bootstrapPassword!=='string'||this.bootstrapPassword.length<16)fail('bootstrap_unconfigured','Configure the initial owner password for this installation.',503);
    if(typeof password!=='string'||password.length<1||password.length>300)fail('password_incorrect','Incorrect password.',401);
    const [actual,expected]=await Promise.all([digest(password),digest(this.bootstrapPassword)]);
    if(!constantEqual(encode.encode(actual),encode.encode(expected)))fail('password_incorrect','Incorrect password.',401);
  }
  async advance(password) {
    // Incorrect requests cannot create or modify any installation tables.
    await this.verifyBootstrap(password);
    let state=await this.inspect();
    if(state.state==='ready')return {setup:{state:'ready',progress:100},continue:false};
    if(state.state==='empty') {
      await this.db.batch([
        this.db.prepare(META),
        this.db.prepare("INSERT INTO setup_state VALUES(1,?,0,'initializing',?,NULL) ON CONFLICT(id) DO NOTHING").bind(await this.fingerprint,new Date(this.now()).toISOString()),
      ]);
      state=await this.inspect();
    }
    const end=Math.min(this.schema.length,state.next_index+this.batchSize),done=end===this.schema.length;
    await this.db.batch([
      ...this.schema.slice(state.next_index,end).map(sql=>this.db.prepare(sql)),
      ...(done?this.seed.map(({sql,params})=>this.db.prepare(sql).bind(...params)):[]),
      this.db.prepare('UPDATE setup_state SET next_index=?,state=?,completed_at=? WHERE id=1 AND schema_fingerprint=? AND next_index=?')
        .bind(end,done?'ready':'initializing',done?new Date(this.now()).toISOString():null,await this.fingerprint,state.next_index),
    ]);
    const latest=await this.inspect();
    return {setup:{state:latest.state,progress:latest.progress},continue:latest.state!=='ready'};
  }
}
