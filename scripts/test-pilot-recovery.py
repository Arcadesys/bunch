"""Rehearse encryption, restore, denial replay and tamper rejection using local synthetic data."""
import json, os, pathlib, secrets, shutil, subprocess, tempfile, time, urllib.parse, uuid
url=urllib.parse.urlparse(os.environ.get('TEST_DATABASE_URL',''))
if url.hostname not in ('127.0.0.1','localhost'):
    raise SystemExit('Recovery test requires a disposable local TEST_DATABASE_URL')
base=os.environ.copy()
base.update(PGHOST=url.hostname,PGPORT=str(url.port or 5432),PGUSER=urllib.parse.unquote(url.username or os.environ.get('USER','')),PGPASSWORD=urllib.parse.unquote(url.password or ''),PGDATABASE=url.path[1:])
target='pilot_restore_'+uuid.uuid4().hex
owner='auth0:recovery-fixture:'+uuid.uuid4().hex
folder=tempfile.mkdtemp(prefix='bunch-recovery-eval-')
runenv=base.copy()
restore=url._replace(path='/'+target).geturl()
runenv.update(DATABASE_URL_UNPOOLED=url.geturl(),PILOT_BACKUP_KEY=secrets.token_hex(32),PILOT_BACKUP_DIR=folder,PILOT_RESTORE_DATABASE_URL=restore)
def run(*args,env=base):return subprocess.run(args,env=env,text=True,capture_output=True,check=True)
def sql(query,env=base):return run('psql','-v','ON_ERROR_STOP=1','-Atc',query,env=env).stdout.strip()
try:
    # IDs are generated locally; no user-supplied text is interpolated into SQL.
    sql(f"insert into app_user(id,google_subject) values('{owner}','{owner}'); insert into pilot_account(owner_id,role) values('{owner}','FRIEND')")
    sql(f"begin; select set_config('app.pilot_purge','{owner}',true); insert into alter_profile(owner_id,name) values('{owner}','Synthetic restore profile'); commit")
    sql(f"begin; select set_config('app.pilot_purge','{owner}',true); insert into conversation_summary(owner_id,alter_id,start_at,end_at,time_zone,summary,coverage) select owner_id,id,now(),now(),'UTC','Synthetic summary excluded from backups','Fixture only' from alter_profile where owner_id='{owner}'; commit")
    run('createdb',target)
    result=run('npx','tsx','scripts/pilot-backup.ts','create',env=runenv)
    backup=json.loads(result.stdout.strip().splitlines()[-1])['backup']
    # A change after the snapshot must still deny access on the restored copy.
    sql(f"update pilot_account set state='REVOKED' where owner_id='{owner}'")
    result=run('npx','tsx','scripts/pilot-backup.ts','verify',backup,env=runenv)
    report=json.loads(result.stdout.strip().splitlines()[-1]);assert report['databaseRestored'] and report['accessClosed'] and report['tombstonesReplayed']>=1
    targetenv=base.copy();targetenv['PGDATABASE']=target
    assert sql(f"select state from pilot_account where owner_id='{owner}'",targetenv)=='REVOKED'
    assert sql(f"select count(*) from alter_profile where owner_id='{owner}'",targetenv)=='1'
    assert sql(f"select count(*) from conversation_summary where owner_id='{owner}'",targetenv)=='0'
    run('dropdb',target);run('createdb',target)
    with open(backup,'r+b') as f:
        f.seek(50);value=f.read(1);f.seek(50);f.write(bytes([value[0]^1]))
    result=subprocess.run(['npx','tsx','scripts/pilot-backup.ts','verify',backup],env=runenv,capture_output=True,text=True)
    assert result.returncode!=0,'Tampering must fail before restoration'
    stale=pathlib.Path(folder)/'diddy-1.diddy-backup';stale.write_bytes(b'synthetic expired artifact');old=time.time()-8*86400;os.utime(stale,(old,old))
    run('npx','tsx','scripts/pilot-backup.ts','prune',env=runenv);assert not stale.exists()
    print('PASS: encrypted restore, post-backup revocation replay, ciphertext tampering, seven-day pruning, summary exclusion. Synthetic fixture has no media.')
finally:
    subprocess.run(['dropdb','--if-exists',target],env=base,capture_output=True)
    sql(f"begin; select set_config('app.pilot_purge','{owner}',true); delete from app_user where id='{owner}'; delete from pilot_account where owner_id='{owner}'; commit")
    shutil.rmtree(folder)
