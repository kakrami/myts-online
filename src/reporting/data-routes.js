import {readAuthBody} from '../application/auth-routes.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function dataFileRoutes(request,{security,dataFiles}){const url=new URL(request.url),path=url.pathname,method=request.method;if(!path.startsWith('/api/data/'))return null;await security.authenticateRequest(request);
 if(['/api/data/exports','/api/data/imports'].includes(path)&&method==='GET')return json(await dataFiles.list({team_id:url.searchParams.get('team_id'),type:path.split('/').at(-1),limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):10,before:url.searchParams.has('before')?Number(url.searchParams.get('before')):null,before_id:url.searchParams.get('before_id')}));
 if(path==='/api/data/exports'&&method==='POST')return json(await dataFiles.create(await readAuthBody(request)),202);
 if(path==='/api/data/imports'&&method==='POST')return json(await dataFiles.startImport(await readAuthBody(request,800000)),201);
 let m=path.match(/^\/api\/data\/exports\/([0-9a-f-]{36})(\/download)?$/);if(m&&method==='GET')return m[2]?dataFiles.download(m[1]):json(await dataFiles.exportStatus(m[1]));
 m=path.match(/^\/api\/data\/imports\/([0-9a-f-]{36})(\/commit)?$/);if(m&&method==='GET'&&!m[2])return json(await dataFiles.importStatus(m[1]));if(m&&method==='POST'&&m[2])return json(await dataFiles.commitImport(m[1]),202);
 m=path.match(/^\/api\/data\/imports\/([0-9a-f-]{36})\/segments\/(\d{1,4})$/);if(m&&method==='PUT')return json(await dataFiles.uploadSegment(m[1],Number(m[2]),await readAuthBody(request,768000)));
 return null;
}
